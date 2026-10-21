import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { checkpoint, findCachedPackage, root, writeProof } from './lib/automation.mjs'
import { derived, requireGameConfig } from './lib/game-config.mjs'

// Live-smoke gate (production): archive names, domain, project and part size come from game.config.json
// (tickets R1/U1) and placeholders refuse to run. Title-screen assertions (choices, routine, canvas, script
// count) apply only once the config knows them — until then they are recorded as skipped, never passed.
const game = derived(requireGameConfig(root, { production: true }))
const { id: GAME_ID, ext: ARCH_EXT, archives: ARCHIVES, partSize: PART_SIZE, domain: CONFIG_DOMAIN,
  cacheName: GAME_CACHE, renderWidth: RENDER_W, renderHeight: RENDER_H,
  expectedScriptCount: EXPECTED_SCRIPTS, titleChoices: TITLE_CHOICES, titleRoutine: TITLE_ROUTINE,
  archiveMagic: ARCHIVE_MAGIC } = game
const archiveAlternation = ARCHIVES.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
const blockSuffix = `.${ARCH_EXT}`
const blockFile = (name, index) => `${name}${blockSuffix}.${index}`
const magicBytes = ARCHIVE_MAGIC ? Buffer.from(ARCHIVE_MAGIC, 'hex') : null
const hasMagic = bytes => !magicBytes || (bytes.length >= magicBytes.length && magicBytes.every((b, i) => bytes[i] === b))

const SAFE_FAILURE = /^[A-Za-z0-9_.:-]{1,100}$/
const MAX_DECLARED_GAME_BYTES = 1024 * 1024 * 1024
const FULL_CACHE_TIMEOUT_MS = 300000

function usage() {
  return `Usage: node scripts/check-deploy.mjs [options]

Options:
  --origin URL       Site to check (default: ${CONFIG_DOMAIN ?? '(required: game.config.json deploy.domain is a placeholder)'})
  --deployment URL   Also check this deployment URL
  --dist PATH        Compare against a local split build directory (default: dist)
  --browser          Run the headless Playwright boot and reload check
  --full-cache       With --browser, wait up to five minutes for every expected game block
  --fresh            Use and remove a fresh browser profile (requires --browser)
  --help             Show this help

The default run makes small anonymous HTTP requests and writes a metadata-only proof to
re/verification/deploy-smoke.json. Browser checks reuse an ignored profile under re/verification.`
}

function parseArgs(args) {
  const options = { origin: CONFIG_DOMAIN, deployment: null, dist: null, browser: false, fullCache: false, fresh: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help' || arg === '-h') return { help: true }
    if (arg === '--browser') options.browser = true
    else if (arg === '--full-cache') options.fullCache = true
    else if (arg === '--fresh') options.fresh = true
    else if (['--origin', '--deployment', '--dist'].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`)
      if (arg === '--origin') options.origin = value
      if (arg === '--deployment') options.deployment = value
      if (arg === '--dist') options.dist = value
    } else throw new Error(`Unknown option: ${arg}`)
  }
  if (!options.origin) throw new Error('No origin: pass --origin or set game.config.json deploy.domain (ticket U1)')
  if (options.fresh && !options.browser) throw new Error('--fresh requires --browser')
  if (options.fullCache && !options.browser) throw new Error('--full-cache requires --browser')
  return options
}

function safeUrl(value, base) {
  const url = new URL(value, base)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('URLs must use HTTP(S) and must not include credentials')
  url.hash = ''
  url.search = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function route(base, path) {
  const url = new URL(base)
  url.pathname = `/${path.replace(/^\/+/, '')}`
  url.search = ''
  url.hash = ''
  return url
}

function resourceLabel(value) {
  try {
    const url = new URL(value)
    return { host: url.host, path: url.pathname }
  } catch { return { host: 'unknown', path: '/' } }
}

function safeFailure(error) {
  const name = SAFE_FAILURE.test(error?.name ?? '') ? error.name : 'Error'
  const codeMatch = /\bnet::(ERR_[A-Z0-9_]+)\b/.exec(error?.message ?? '')
  return { name, category: codeMatch?.[1] ?? (/timeout/i.test(error?.name ?? '') ? 'Timeout' : 'Other') }
}

function mime(response) {
  return (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
}

function hasChallenge(response) { return response.headers.has('www-authenticate') }

async function request(url, init = {}) {
  const started = Date.now()
  try {
    const response = await fetch(url, { redirect: 'follow', ...init })
    return { response, result: { status: response.status, durationMs: Date.now() - started,
      contentType: mime(response), wwwAuthenticate: hasChallenge(response), final: resourceLabel(response.url || url.href) } }
  } catch (error) {
    return { response: null, result: { status: null, durationMs: Date.now() - started,
      failure: safeFailure(error), resource: resourceLabel(url.href), wwwAuthenticate: false } }
  }
}

async function readBounded(response, maxBytes) {
  const header = response.headers.get('content-length')
  const advertisedBytes = header && /^\d+$/.test(header) ? Number(header) : null
  if (advertisedBytes !== null && advertisedBytes > maxBytes) {
    await response.body?.cancel()
    return { bytes: null, tooLarge: true, advertisedBytes }
  }
  const reader = response.body?.getReader()
  if (!reader) return { bytes: new Uint8Array(), tooLarge: false, advertisedBytes }
  const chunks = []
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) { await reader.cancel(); return { bytes: null, tooLarge: true, advertisedBytes } }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return { bytes, tooLarge: false, advertisedBytes }
}

async function readJson(response, maxBytes = 65536) {
  try {
    const body = await readBounded(response, maxBytes)
    return body.bytes && !body.tooLarge ? JSON.parse(new TextDecoder().decode(body.bytes)) : null
  } catch { return null }
}

function validParts(value) {
  return !!value && value.partSize === PART_SIZE &&
    typeof value.version === 'string' && /^[a-f0-9]{12}$/i.test(value.version) &&
    !!value.sizes && typeof value.sizes === 'object' && !Array.isArray(value.sizes) &&
    Object.keys(value.sizes).length === ARCHIVES.length && ARCHIVES.every(name => Number.isSafeInteger(value.sizes[name]) && value.sizes[name] > 0 && value.sizes[name] <= MAX_DECLARED_GAME_BYTES) &&
    Object.values(value.sizes).reduce((sum, size) => sum + size, 0) <= MAX_DECLARED_GAME_BYTES
}

function expectedBlocks(parts) {
  return validParts(parts) ? Object.values(parts.sizes).reduce((total, size) => total + Math.ceil(size / parts.partSize), 0) : null
}

async function runHttp(base, localDist) {
  const checks = {}
  const challengePaths = []
  const noteChallenge = (label, check) => { if (check?.wwwAuthenticate) challengePaths.push(label) }

  const htmlRequest = await request(route(base, ''))
  checks.root = { ...htmlRequest.result, ok: htmlRequest.response?.status === 200 && mime(htmlRequest.response) === 'text/html' && !htmlRequest.result.wwwAuthenticate }
  noteChallenge('root', htmlRequest.result)
  let html = ''
  if (htmlRequest.response && checks.root.ok) {
    try { html = await htmlRequest.response.text() } catch { checks.root.ok = false }
  } else await htmlRequest.response?.body?.cancel()

  const jsPath = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi)]
    .map(match => match[1]).find(path => /(?:^|\/)assets\/[^/]+-[A-Za-z0-9_-]{8,}\.js(?:\?|$)/.test(path))
    ?? [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi)].map(match => match[1])[0]
  if (jsPath) {
    const jsUrl = new URL(jsPath, base)
    if (jsUrl.origin === base.origin) {
      const result = await request(jsUrl)
      checks.javascript = { ...result.result, ok: result.response?.status === 200 && mime(result.response).includes('javascript') && !result.result.wwwAuthenticate }
      noteChallenge('javascript', result.result)
      await result.response?.body?.cancel()
    } else checks.javascript = { status: null, ok: false, failure: { name: 'Error', category: 'ExternalAsset' } }
  } else checks.javascript = { status: null, ok: false, failure: { name: 'Error', category: 'HashedAssetMissing' } }

  const sw = await request(route(base, 'sw.js'))
  checks.serviceWorker = { ...sw.result, ok: sw.response?.status === 200 && mime(sw.response).includes('javascript') && !sw.result.wwwAuthenticate }
  noteChallenge('serviceWorker', sw.result)
  await sw.response?.body?.cancel()

  const manifestHref = /<link\b(?=[^>]*\brel=["'][^"']*manifest[^"']*["'])[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(html)?.[1]
  const manifestUrl = new URL(manifestHref ?? '/manifest.webmanifest', base)
  const manifestResponse = await request(manifestUrl)
  const manifest = manifestResponse.response && manifestResponse.result.contentType.includes('json') ? await readJson(manifestResponse.response) : null
  checks.manifest = { ...manifestResponse.result,
    schema: manifest ? { name: typeof manifest.name === 'string', start_url: typeof manifest.start_url === 'string', display: typeof manifest.display === 'string' } : null,
    ok: manifestResponse.response?.status === 200 && !!manifest && typeof manifest.name === 'string' &&
      typeof manifest.start_url === 'string' && typeof manifest.display === 'string' && !manifestResponse.result.wwwAuthenticate }
  noteChallenge('manifest', manifestResponse.result)

  const partsResponse = await request(route(base, 'game/parts.json'))
  const partsLooksSplit = partsResponse.result.status === 200 && partsResponse.result.contentType.includes('json')
  const parts = partsResponse.response && partsLooksSplit ? await readJson(partsResponse.response) : null
  const validSplit = validParts(parts)
  const unsplitPreview = partsResponse.result.status === 404 || (partsResponse.result.status === 200 && partsResponse.result.contentType === 'text/html')
  if (validSplit) checks.partsManifest = { status: partsResponse.result.status, ok: !partsResponse.result.wwwAuthenticate,
    schemaValid: true, mode: 'split', version: parts.version, archiveCount: Object.keys(parts.sizes).length,
    expectedCachedBlocks: expectedBlocks(parts), wwwAuthenticate: partsResponse.result.wwwAuthenticate }
  else checks.partsManifest = { status: partsResponse.result.status, ok: !partsLooksSplit && unsplitPreview && !partsResponse.result.wwwAuthenticate,
    schemaValid: partsLooksSplit ? false : null, mode: partsLooksSplit ? 'invalid' : 'unsplit', wwwAuthenticate: partsResponse.result.wwwAuthenticate }
  noteChallenge('partsManifest', partsResponse.result)

  let block = null
  if (validSplit) {
    const archive = ARCHIVES[0]
    const blockUrl = route(base, `game/${blockFile(archive, 0)}`)
    blockUrl.searchParams.set('v', parts.version)
    const blockResponse = await request(blockUrl)
    const expectedBytes = Math.min(parts.partSize, parts.sizes[archive])
    const loaded = blockResponse.response ? await readBounded(blockResponse.response, expectedBytes) : { bytes: null, tooLarge: false, advertisedBytes: null }
    const bytes = loaded.bytes
    const safeBlock = blockResponse.response && blockResponse.response.status === 200 &&
      !blockResponse.result.wwwAuthenticate && !blockResponse.result.contentType.includes('text/html') &&
      !loaded.tooLarge && !!bytes
    if (safeBlock) {
      block = bytes
      checks.firstArchiveBlock = { status: 200, durationMs: blockResponse.result.durationMs, bytes: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'), magicMatch: hasMagic(bytes),
        expectedBytes, advertisedBytes: loaded.advertisedBytes, wwwAuthenticate: false }
      checks.firstArchiveBlock.ok = checks.firstArchiveBlock.magicMatch && bytes.byteLength === expectedBytes
    } else {
      checks.firstArchiveBlock = { ...blockResponse.result, ok: false, magicMatch: false, expectedBytes,
        advertisedBytes: loaded.advertisedBytes, tooLarge: loaded.tooLarge }
    }
    noteChallenge('firstArchiveBlock', blockResponse.result)
  } else if (!partsLooksSplit && unsplitPreview) {
    const wholeUrl = route(base, `game/${ARCHIVES[0]}${blockSuffix}`)
    const result = await request(wholeUrl, { headers: { Range: 'bytes=0-63' } })
    if (result.response?.status === 206 && !result.result.wwwAuthenticate) {
      const loaded = await readBounded(result.response, 64)
      const bytes = loaded.bytes
      if (loaded.tooLarge || !bytes) {
        checks.firstArchiveBlock = { status: 206, durationMs: result.result.durationMs, bytes: null,
          expectedBytes: 64, tooLarge: true, ok: false, magicMatch: false }
      } else {
        block = bytes
        checks.firstArchiveBlock = { status: 206, durationMs: result.result.durationMs, bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'), magicMatch: hasMagic(bytes), expectedBytes: 64,
          advertisedBytes: loaded.advertisedBytes, wwwAuthenticate: false }
        checks.firstArchiveBlock.ok = checks.firstArchiveBlock.magicMatch && bytes.byteLength === 64
      }
    } else {
      await result.response?.body?.cancel()
      checks.firstArchiveBlock = { ...result.result, ok: false, rangeSupported: result.response?.status === 206, magicMatch: false }
    }
    noteChallenge('firstArchiveBlock', result.result)
  } else {
    checks.firstArchiveBlock = { status: partsResponse.result.status, ok: false, failure: { name: 'Error', category: 'InvalidPartsManifest' } }
  }

  if (localDist) {
    const local = await compareDist(localDist, parts, block)
    checks.localDist = local
  }
  return { checks, parts: validParts(parts) ? parts : null, manifest, challengePaths, blockSha256: block ? createHash('sha256').update(block).digest('hex') : null }
}

async function compareDist(distPath, remoteParts, remoteBlock) {
  try {
    const gameDir = join(distPath, 'game')
    const localParts = JSON.parse(await readFile(join(gameDir, 'parts.json'), 'utf8'))
    if (!validParts(localParts)) return { ok: false, failure: { name: 'Error', category: 'InvalidLocalPartsManifest' } }
    const sameManifest = remoteParts && JSON.stringify(localParts) === JSON.stringify(remoteParts)
    const archive = Object.keys(localParts.sizes).sort()[0]
    const localBlock = await readFile(join(gameDir, blockFile(archive, 0)))
    const localSha256 = createHash('sha256').update(localBlock).digest('hex')
    const remoteSha256 = remoteBlock ? createHash('sha256').update(remoteBlock).digest('hex') : null
    return { ok: !!sameManifest && !!remoteSha256 && localSha256 === remoteSha256,
      manifestMatches: !!sameManifest, archiveCount: Object.keys(localParts.sizes).length,
      firstBlock: { localBytes: localBlock.byteLength, remoteBytes: remoteBlock?.byteLength ?? null,
        localSha256, remoteSha256, matches: !!remoteSha256 && localSha256 === remoteSha256 } }
  } catch (error) { return { ok: false, failure: safeFailure(error) } }
}

function loadPlaywright() {
  const configured = process.env.GAME_PLAYWRIGHT_MODULE
  const packagePath = configured ? resolve(configured) : join(findCachedPackage('playwright'), 'index.js')
  return createRequire(import.meta.url)(packagePath)
}

function safeName(value) { return SAFE_FAILURE.test(value ?? '') ? value : 'Error' }

async function runBrowser(base, parts, fullCache, fresh) {
  if (fullCache && !validParts(parts)) return { ok: false, fullCacheRequested: true, failure: { name: 'Error', category: 'FullCacheRequiresSplitManifest' } }
  const expected = validParts(parts) ? expectedBlocks(parts) : null
  const expectedByArchive = validParts(parts) ? Object.fromEntries(ARCHIVES.map(name => [name, Math.ceil(parts.sizes[name] / parts.partSize)])) : null
  const { chromium } = loadPlaywright()
  const verifyDir = join(root, 're', 'verification')
  await mkdir(verifyDir, { recursive: true })
  const profile = fresh ? join(verifyDir, `browser-profile-fresh-${process.pid}`) : join(verifyDir, 'browser-profile')
  const channel = process.env.GAME_BROWSER_CHANNEL || 'chrome'
  const started = Date.now()
  const exceptions = []
  const challengePaths = []
  const failedResources = []
  const consoleCounts = {}
  let phase = 'launch'
  let context
  let result
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, channel,
      viewport: { width: 1280, height: 900 }, args: ['--disable-background-timer-throttling'] })
    const page = context.pages()[0] ?? await context.newPage()
    page.on('console', message => { const type = safeName(message.type()); consoleCounts[type] = (consoleCounts[type] ?? 0) + 1 })
    page.on('pageerror', error => exceptions.push(safeName(error?.name)))
    page.on('response', response => {
      if (response.headers()['www-authenticate'] !== undefined) challengePaths.push(resourceLabel(response.url()).path)
    })
    page.on('requestfailed', request => {
      const failure = request.failure()?.errorText ?? ''
      failedResources.push({ ...resourceLabel(request.url()), status: null,
        category: /^net::ERR_[A-Z0-9_]+$/.test(failure) ? failure.slice(5) : 'RequestFailed' })
    })

    const boot = async label => {
      let fullCacheWaitMs = null
      let fullCacheStatus = null
      phase = `${label}:navigate`
      let navigation
      try { navigation = await page.goto(base.href, { waitUntil: 'domcontentloaded', timeout: 30000 }) }
      catch (error) { throw Object.assign(new Error(), { name: error?.name, code: error?.message }) }
      const initialStatus = navigation?.status() ?? null
      const initialUrlHasFragment = !!new URL(page.url()).hash
      phase = `${label}:canvas`
      const canvas = page.locator('canvas').first()
      await canvas.waitFor({ state: 'visible', timeout: 15000 })
      phase = `${label}:unlock`
      await canvas.click({ position: { x: 12, y: 12 }, timeout: 10000 })
      phase = `${label}:title`
      await page.waitForFunction(({ routine, choices }) => {
        const game = window.game
        if (!game?.vm || typeof game.choices !== 'function') return false
        if (routine !== null) {
          const names = []
          for (const frame of (game.vm.main?.frames ?? [])) names.push(frame.r?.name ?? '')
          for (const thread of (game.vm.threads ?? [])) for (const frame of (thread.frames ?? [])) names.push(frame.routine?.name ?? frame.r?.name ?? '')
          if (!names.includes(routine)) return false
        }
        const n = game.choices().length
        return choices === null ? n >= 1 : n === choices
      }, { routine: TITLE_ROUTINE, choices: TITLE_CHOICES }, { polling: 250, timeout: 120000 })
      if (fullCache) {
        phase = `${label}:full-cache`
        const waitStarted = Date.now()
          const deadline = waitStarted + FULL_CACHE_TIMEOUT_MS
          let previousDone = 0
          fullCacheStatus = { status: 'waiting', done: 0, total: expected, reason: 'cache-not-created' }
          while (Date.now() < deadline) {
            const observed = await page.evaluate(async ({ expectedCounts, cacheName, ext }) => {
              const cacheNames = await caches.keys()
              if (!cacheNames.includes(cacheName)) return { done: 0, total: Object.values(expectedCounts).reduce((sum, count) => sum + count, 0), complete: false, reason: 'cache-not-created' }
              const cache = await caches.open(cacheName)
              const cached = Object.fromEntries(Object.keys(expectedCounts).map(name => [name, new Set()]))
              for (const request of await cache.keys()) {
                const filename = new URL(request.url).pathname.split('/').pop() ?? ''
                for (const name of Object.keys(expectedCounts)) {
                  const prefix = `${name}.${ext}.`
                  if (!filename.startsWith(prefix)) continue
                  const suffix = filename.slice(prefix.length)
                  if (/^\d+$/.test(suffix)) {
                    const index = Number(suffix)
                    if (Number.isSafeInteger(index) && index >= 0 && index < expectedCounts[name]) cached[name].add(index)
                  }
                  break
                }
              }
              const byArchive = Object.fromEntries(Object.entries(cached).map(([name, indexes]) => [name, indexes.size]))
              const done = Object.values(byArchive).reduce((sum, count) => sum + count, 0)
              const total = Object.values(expectedCounts).reduce((sum, count) => sum + count, 0)
              const complete = done === total && Object.entries(expectedCounts).every(([name, count]) => cached[name].size === count)
              return { done, total, complete, byArchive, reason: complete ? 'all-expected-blocks-present' : 'missing-blocks' }
            }, { expectedCounts: expectedByArchive, cacheName: GAME_CACHE, ext: ARCH_EXT })
            const elapsed = Date.now() - waitStarted
            const status = observed.complete ? 'complete' : observed.done > previousDone ? 'caching' : observed.done > 0 ? 'partial' : 'waiting'
            fullCacheStatus = { status, done: observed.done, total: observed.total, byArchive: observed.byArchive ?? null, reason: observed.reason }
            previousDone = observed.done
            if (observed.complete) break
            await page.waitForTimeout(Math.min(500, Math.max(1, deadline - Date.now())))
          }
        fullCacheWaitMs = Date.now() - waitStarted
      }
      phase = `${label}:state`
      const state = await page.evaluate(async ({ initial, expectedCount, expectedCounts, cacheName, blockPattern, routine }) => {
        const game = window.game
        const canvas = document.querySelector('canvas')
        let gl = null
        try { gl = canvas?.getContext('webgl2') } catch {}
        const cacheNames = await caches.keys()
        const cache = cacheNames.includes(cacheName) ? await caches.open(cacheName) : null
        const names = Object.keys(expectedCounts ?? {})
        const cachedBlocksByArchive = Object.fromEntries(names.map(name => [name, 0]))
        const cachedIndexesByArchive = Object.fromEntries(names.map(name => [name, new Set()]))
        const blockRe = new RegExp(blockPattern, 'i')
        if (cache) for (const request of await cache.keys()) {
          const match = blockRe.exec(new URL(request.url).pathname)
          const name = match?.[1]?.toLowerCase(), index = Number(match?.[2])
          if (name && name in cachedBlocksByArchive) { cachedBlocksByArchive[name]++; cachedIndexesByArchive[name].add(index) }
        }
        const cachedBlockCount = Object.values(cachedBlocksByArchive).reduce((sum, count) => sum + count, 0)
        const complete = expectedCounts === null ? null : Object.entries(expectedCounts).every(([name, count]) => {
          for (let index = 0; index < count; index++) if (!cachedIndexesByArchive[name].has(index)) return false
          return true
        })
        const frames = (game.vm.main?.frames ?? []).map(frame => frame.r?.name ?? '')
        const titleSelect = routine === null ? null : (frames.includes(routine) ||
          (game.vm.threads ?? []).some(thread => (thread.frames ?? []).some(frame => frame.routine?.name === routine)))
        return { initial, titleSelect, choiceCount: game.choices().length, scriptCount: game.scripts.size,
          webgl2: !!gl, canvas: canvas ? [canvas.width, canvas.height] : null,
          gameCache: { name: cacheName, present: !!cache, cachedBlockCount, cachedBlocksByArchive,
            expectedBlockCount: expectedCount, expectedBlocksByArchive: expectedCounts, complete },
          gameCachePresent: !!cache, unknownBuiltins: game.vm.unknownBuiltins?.size ?? game.vm.unknownBuiltins?.length ?? null,
          urlHasFragment: !!new URL(location.href).hash }
      }, { initial: { status: initialStatus, urlHasFragment: initialUrlHasFragment }, expectedCount: expected, expectedCounts: expectedByArchive,
        cacheName: GAME_CACHE, blockPattern: `/game/(${archiveAlternation})\\.${ARCH_EXT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)$`,
        routine: TITLE_ROUTINE })
      state.fullCacheWaitMs = fullCacheWaitMs
      state.fullCacheStatus = fullCacheStatus
      return state
    }

    const first = await boot('first')
    const reload = await boot('reload')
    phase = 'cookies'
    const cookies = await context.cookies(base.href)
    const authCookiesPresent = cookies.some(cookie => /auth|session|password|access/i.test(cookie.name))
    // Assertions the config cannot make yet (null until the title boots) are recorded as skipped,
    // never passed: the proof says exactly what this run did not check.
    const skippedAssertions = [
      ...(TITLE_ROUTINE === null ? ['titleRoutine'] : []),
      ...(TITLE_CHOICES === null ? ['titleChoices'] : []),
      ...(EXPECTED_SCRIPTS === null ? ['scriptCount'] : []),
      ...((RENDER_W === null || RENDER_H === null) ? ['canvasSize'] : []),
    ]
    const stateOk = state => state.initial.status === 200 && !state.initial.urlHasFragment && state.titleSelect !== false &&
      (TITLE_CHOICES === null ? state.choiceCount >= 1 : state.choiceCount === TITLE_CHOICES) &&
      (EXPECTED_SCRIPTS === null ? state.scriptCount >= 1 : state.scriptCount === EXPECTED_SCRIPTS) && state.webgl2 &&
      ((RENDER_W === null || RENDER_H === null) ? state.canvas !== null : JSON.stringify(state.canvas) === JSON.stringify([RENDER_W, RENDER_H])) &&
      state.unknownBuiltins === 0 && !state.urlHasFragment
    const optionalAnalytics = failedResources.filter(resource => resource.host === 'static.cloudflareinsights.com' &&
      /^\/beacon\.min\.js(?:\/|$)/.test(resource.path))
    const requiredFailures = failedResources.filter(resource => !optionalAnalytics.includes(resource))
    result = { ok: stateOk(first) && stateOk(reload) && (!fullCache || (first.gameCache.complete && reload.gameCache.complete)) &&
        exceptions.length === 0 && requiredFailures.length === 0 && challengePaths.length === 0 && !authCookiesPresent,
      channel, skippedAssertions, fullCacheRequested: fullCache, fullCacheTimeoutMs: fullCache ? FULL_CACHE_TIMEOUT_MS : null, first, reload,
      expectedCachedBlocks: expected, gameCacheStates: [first.gameCache, reload.gameCache], pageExceptionCount: exceptions.length,
      pageExceptionNames: [...new Set(exceptions)].slice(0, 8), consoleCounts,
      failedResourceCount: failedResources.length, failedResources: failedResources.slice(0, 12),
      requiredFailedResourceCount: requiredFailures.length, optionalAnalyticsFailureCount: optionalAnalytics.length,
      authCookiesPresent, cookieCount: cookies.length, wwwAuthenticatePaths: [...new Set(challengePaths)].slice(0, 12),
      durationMs: Date.now() - started }
  } catch (error) {
    result = { ok: false, channel, phase, failure: safeFailure({ name: error?.name, message: error?.code ?? error?.message }),
      pageExceptionCount: exceptions.length, consoleCounts, failedResourceCount: failedResources.length,
      failedResources: failedResources.slice(0, 12), wwwAuthenticatePaths: [...new Set(challengePaths)].slice(0, 12),
      durationMs: Date.now() - started }
  } finally {
    await context?.close().catch(() => {})
    if (fresh) await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
  return result
}

function overallOk(browser, targets) {
  const httpOk = targets.every(target => Object.values(target.checks).every(check => check.ok))
  return httpOk && (!browser || browser.ok)
}

function printSummary(proof, proofPath) {
  const checks = (proof.targets ?? []).flatMap(target => Object.entries(target.checks).map(([name, check]) =>
    ({ target: target.label, name, ok: check.ok })))
  const browser = proof.browser
  console.log(JSON.stringify({ ok: proof.ok, durationMs: proof.durationMs,
    http: { passed: checks.filter(check => check.ok).length, total: checks.length,
      failures: checks.filter(check => !check.ok).map(({ target, name }) => ({ target, name })) },
    ...(browser ? { browser: { ok: browser.ok, phase: browser.phase ?? null, failure: browser.failure ?? null,
      scripts: browser.first?.scriptCount ?? null, titleChoices: browser.first?.choiceCount ?? null,
      cachedBlocks: browser.reload?.gameCache.cachedBlockCount ?? null, expectedBlocks: browser.expectedCachedBlocks,
      fullCache: browser.reload?.gameCache.complete ?? null, skippedAssertions: browser.skippedAssertions ?? null,
      pageExceptions: browser.pageExceptionCount, failedResources: browser.failedResourceCount,
      requiredFailedResources: browser.requiredFailedResourceCount ?? browser.failedResourceCount,
      optionalAnalyticsFailures: browser.optionalAnalyticsFailureCount ?? 0 } } : {}),
    ...(proof.failure ? { failure: proof.failure } : {}), proof: proofPath }))
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) { console.log(usage()); return }
  const origin = safeUrl(options.origin)
  const deployment = options.deployment ? safeUrl(options.deployment) : null
  const distPath = options.dist ? resolve(root, options.dist) : null
  const targets = []
  let browser = null
  let phase = 'http'
  const started = Date.now()
  const urls = [{ label: 'origin', url: origin }, ...(deployment ? [{ label: 'deployment', url: deployment }] : [])]
  for (const target of urls) {
    const checked = await runHttp(target.url, target.label === 'origin' ? distPath : null)
    targets.push({ label: target.label, ...checked })
  }
  if (options.browser) {
    phase = 'browser'
    const primary = targets[0]
    browser = await runBrowser(origin, primary.parts, options.fullCache, options.fresh)
  }
  const proof = { ok: overallOk(browser, targets), source: checkpoint(), durationMs: Date.now() - started,
    targets: targets.map(({ parts, manifest, blockSha256, ...target }) => ({ ...target,
      expectedCachedBlocks: expectedBlocks(parts), manifestNamePresent: typeof manifest?.name === 'string', firstBlockSha256: blockSha256 })),
    ...(browser ? { browser } : {}) }
  const proofPath = await writeProof('re/verification/deploy-smoke.json', proof)
  printSummary(proof, proofPath)
  if (!proof.ok) process.exitCode = 1
}

try { await main() } catch (error) {
  const proof = { ok: false, source: checkpoint(), failure: safeFailure(error), durationMs: 0 }
  const proofPath = await writeProof('re/verification/deploy-smoke.json', proof).catch(() => null)
  printSummary(proof, proofPath)
  if (process.argv.includes('--help')) process.stdout.write(`${usage()}\n`)
  process.exitCode = 1
}
