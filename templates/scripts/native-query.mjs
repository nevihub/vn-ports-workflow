import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, open, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { findCachedPackage, root, writeProof } from './lib/automation.mjs'

const TARGET = '<game-install>/saya.exe'
const TARGET_SHA256 = '903f298556f45174ea2dbeaf4a0aebe2986a54a47082fa2dbc4b14af672105c2'
const FALLBACK_GHIDRA = 'C:/Tools/ghidra_12.1.4_PUBLIC'
const FALLBACK_JAVA = 'C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot'
const PROVIDER = 'ghidra'
const STARTUP_TIMEOUT_MS = '900000'
const QUERY_TIMEOUT_MS = 20 * 60 * 1000
const MAX_STREAM_BYTES = 32 * 1024 * 1024
const usage = `Usage: npm run native-query -- [--refresh] <address> [address ...]
       npm run native-query -- --import <complete-evidence.json>
       npm run native-query -- --status [address ...]

Decompiles the immutable original saya.exe with the cached REA CLI and Ghidra.
Addresses run sequentially. Full JSON and stderr stay under ignored re/scratch/.
Matching verified target/procedure/provider/tool evidence is cached locally.
--refresh reruns addresses; --import validates and adopts an existing complete
REA Evidence record without starting Ghidra. --status checks cache and live PID locks.`

const scratch = join(root, 're', 'scratch', 'native-query')
const cacheDir = join(scratch, 'cache')
const lockDir = join(scratch, 'locks')
const sepRoot = resolve(root, 're') + sep

function inRepoRe(path) {
  const absolute = resolve(root, path)
  if (!absolute.toLowerCase().startsWith(sepRoot.toLowerCase())) throw coded('PATH_OUTSIDE_RE')
  return absolute
}

function rel(path) { return relative(root, path).split(sep).join('/') }
function coded(code) { return Object.assign(new Error(code), { code }) }
function safeCode(value) { return /^[A-Z0-9_]{1,48}$/.test(value ?? '') ? value : 'ERROR' }
function normPath(value) { return resolve(value).replaceAll('\\', '/').toLowerCase() }

function normalizeProcedure(value) {
  if (typeof value !== 'string') throw coded('INVALID_PROCEDURE')
  const match = /^(file-offset:)?(?:0x)?([0-9a-f]+)$/i.exec(value.trim())
  if (!match) throw coded('INVALID_PROCEDURE')
  const address = BigInt(`0x${match[2]}`).toString(16)
  return `${match[1] ? 'file-offset:' : ''}0x${address}`
}

async function sha256(path) {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash('sha256'), stream = createReadStream(path)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch { return null }
}

async function setup() {
  const exe = await realpath(TARGET).catch(() => { throw coded('TARGET_UNAVAILABLE') })
  const targetHash = await sha256(exe).catch(() => { throw coded('TARGET_UNREADABLE') })
  if (targetHash !== TARGET_SHA256) throw coded('TARGET_HASH_MISMATCH')

  let packageDir, packageJson
  try {
    packageDir = findCachedPackage('rea-agents')
    packageJson = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
  } catch { throw coded('REA_PACKAGE_UNAVAILABLE') }
  const cli = join(packageDir, 'scripts', 'rea.mjs')
  if (!packageJson?.version || !(await stat(cli).catch(() => null))?.isFile()) throw coded('REA_CLI_UNAVAILABLE')

  const env = { ...process.env }
  if (!env.GHIDRA_INSTALL_DIR) env.GHIDRA_INSTALL_DIR = FALLBACK_GHIDRA
  if (!env.JAVA_HOME) env.JAVA_HOME = FALLBACK_JAVA
  if (!env.REA_GHIDRA_STARTUP_TIMEOUT_MS) env.REA_GHIDRA_STARTUP_TIMEOUT_MS = STARTUP_TIMEOUT_MS
  const ghidraDir = resolve(env.GHIDRA_INSTALL_DIR)
  const javaHome = resolve(env.JAVA_HOME)
  const javaExe = join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  if (!(await stat(ghidraDir).catch(() => null))?.isDirectory()) throw coded('GHIDRA_UNAVAILABLE')
  if (!(await stat(javaExe).catch(() => null))?.isFile()) throw coded('JAVA_UNAVAILABLE')
  const ghidraVersion = /ghidra[_-](\d+\.\d+\.\d+)/i.exec(basename(ghidraDir))?.[1] ?? null
  const tool = {
    rea: { name: 'rea-agents', version: packageJson.version, cliSha256: await sha256(cli) },
    provider: { id: PROVIDER, version: ghidraVersion, installPath: normPath(ghidraDir) },
    java: { home: normPath(javaHome), executableSha256: await sha256(javaExe) },
  }
  return { exe, targetHash, cli, env, tool }
}

function cacheKey(context, procedure) {
  return createHash('sha256').update(JSON.stringify({ targetSha256: context.targetHash, procedure, provider: PROVIDER, tool: context.tool })).digest('hex')
}

function evidenceError(evidence, context, procedure) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return 'EVIDENCE_NOT_OBJECT'
  if (evidence.error || evidence.code || evidence.retryable === true) return 'EVIDENCE_IS_ERROR'
  if (evidence.operation !== 'procedure_pseudo_code') return 'EVIDENCE_OPERATION_MISMATCH'
  if (typeof evidence.evidence_id !== 'string' || !/^ev_[a-f0-9]{16,}$/i.test(evidence.evidence_id)) return 'EVIDENCE_ID_MISSING'
  if (evidence.provider?.id !== PROVIDER) return 'EVIDENCE_PROVIDER_MISMATCH'
  if (context.tool?.provider?.version && evidence.provider?.version !== context.tool.provider.version) return 'EVIDENCE_PROVIDER_VERSION_MISMATCH'
  if (normPath(evidence.subject?.local_path ?? '') !== normPath(context.exe)) return 'EVIDENCE_TARGET_PATH_MISMATCH'
  if (String(evidence.subject?.digest?.sha256 ?? '').toLowerCase() !== context.targetHash) return 'EVIDENCE_TARGET_HASH_MISMATCH'
  let actualProcedure
  try { actualProcedure = normalizeProcedure(evidence.parameters?.procedure) } catch { return 'EVIDENCE_PROCEDURE_MISSING' }
  if (actualProcedure !== procedure) return 'EVIDENCE_PROCEDURE_MISMATCH'
  if (typeof evidence.raw_result?.value !== 'string' || !evidence.raw_result.value.trim()) return 'EVIDENCE_RAW_RESULT_INCOMPLETE'
  if (typeof evidence.normalized_result !== 'string' || !evidence.normalized_result.trim()) return 'EVIDENCE_NORMALIZED_RESULT_INCOMPLETE'
  return null
}

function cachePaths(key) {
  return { entry: join(cacheDir, `entry-${key}.json`), raw: join(scratch, `raw-${key}.json`),
    stderr: join(scratch, `stderr-${key}.txt`), lock: join(lockDir, `query-${key}.json`) }
}

async function validCache(context, procedure, key) {
  const paths = cachePaths(key), entry = await readJson(paths.entry)
  if (!entry) return { exists: !!(await stat(paths.entry).catch(() => null)), valid: false }
  const error = entry.schemaVersion === 1 && entry.cacheKey === key && entry.procedure === procedure &&
    entry.target?.sha256 === context.targetHash && JSON.stringify(entry.tool) === JSON.stringify(context.tool)
    ? evidenceError(entry.evidence, context, procedure) : 'CACHE_METADATA_MISMATCH'
  return { exists: true, valid: !error, error, entry, paths }
}

function pidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (error) { return error?.code === 'EPERM' }
}

async function lockStatus(path) {
  const lock = await readJson(path)
  if (!lock) return { state: (await stat(path).catch(() => null)) ? 'invalid' : 'absent' }
  const ownerAlive = pidAlive(lock.pid), childAlive = pidAlive(lock.childPid)
  return { state: ownerAlive || childAlive ? 'running' : 'stale', pid: lock.pid, ownerAlive,
    procedure: lock.procedure, startedAt: lock.startedAt, childPid: lock.childPid ?? null, childAlive }
}

async function acquireLock(path, data) {
  await mkdir(dirname(path), { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx')
      await file.writeFile(JSON.stringify(data, null, 2))
      await file.close()
      return data.ownerToken
    } catch (error) {
      if (error?.code !== 'EEXIST') throw coded('LOCK_CREATE_FAILED')
      const status = await lockStatus(path)
      if (status.state === 'running') throw coded('QUERY_ALREADY_RUNNING')
      await rm(path, { force: true }).catch(() => {})
    }
  }
  throw coded('LOCK_RACE')
}

async function updateLock(path, token, change) {
  const existing = await readJson(path)
  if (existing?.ownerToken !== token) return
  await writeFile(path, JSON.stringify({ ...existing, ...change }, null, 2)).catch(() => {})
}

async function releaseLock(path, token) {
  const existing = await readJson(path)
  if (existing?.ownerToken === token) await rm(path, { force: true }).catch(() => {})
}

function completeSummary(procedure, entry, cacheHit) {
  return { ok: true, procedure, cacheHit, source: entry.source, evidenceId: entry.evidence.evidence_id,
    provider: entry.tool.provider, rea: { version: entry.tool.rea.version, cliSha256: entry.tool.rea.cliSha256 },
    rawJson: entry.rawJson, stderr: entry.stderr, durationMs: entry.durationMs ?? null }
}

async function storeEvidence(context, procedure, evidence, paths, source, durationMs = null, stderrText = '') {
  const error = evidenceError(evidence, context, procedure)
  if (error) throw coded(error)
  await mkdir(cacheDir, { recursive: true })
  await writeFile(paths.raw, JSON.stringify(evidence, null, 2) + '\n')
  await writeFile(paths.stderr, stderrText)
  const entry = { schemaVersion: 1, cacheKey: cacheKey(context, procedure), createdAt: new Date().toISOString(),
    source, procedure, target: { path: context.exe, sha256: context.targetHash }, tool: context.tool,
    rawJson: rel(paths.raw), stderr: rel(paths.stderr), durationMs, evidence }
  await writeProof(rel(paths.entry), entry)
  return entry
}

async function cachedQuery(context, procedure, refresh) {
  const key = cacheKey(context, procedure), paths = cachePaths(key)
  const cache = await validCache(context, procedure, key)
  if (cache.exists && !cache.valid && !refresh) throw coded(cache.error ?? 'CACHE_INVALID_USE_REFRESH')
  if (cache.valid && !refresh) return completeSummary(procedure, cache.entry, true)

  const ownerToken = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const lockData = { pid: process.pid, childPid: null, ownerToken, procedure, cacheKey: key, startedAt: new Date().toISOString() }
  await acquireLock(paths.lock, lockData)
  try {
    const again = await validCache(context, procedure, key)
    if (again.valid && !refresh) return completeSummary(procedure, again.entry, true)
    const child = spawn(process.execPath, [context.cli, 'decompile', context.exe, procedure, '--provider', PROVIDER, '--format', 'json'], {
      cwd: root, env: context.env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
    })
    await updateLock(paths.lock, ownerToken, { childPid: child.pid ?? null })
    const stdout = [], stderr = []
    let stdoutSize = 0, stderrSize = 0, outputTooLarge = false, timer
    const collect = (stream, chunks, kind) => stream.on('data', chunk => {
      if (kind === 'stdout') stdoutSize += chunk.length
      else stderrSize += chunk.length
      if (stdoutSize > MAX_STREAM_BYTES || stderrSize > MAX_STREAM_BYTES) {
        outputTooLarge = true
        child.kill()
        return
      }
      chunks.push(chunk)
    })
    collect(child.stdout, stdout, 'stdout')
    collect(child.stderr, stderr, 'stderr')
    const started = Date.now()
    const result = await new Promise(resolveResult => {
      timer = setTimeout(() => child.kill(), QUERY_TIMEOUT_MS)
      let spawnError = null
      child.on('error', error => { spawnError = safeCode(error?.code) })
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer)
        resolveResult({ exitCode, signal: signal ?? null, spawnError, durationMs: Date.now() - started })
      })
    })
    const out = Buffer.concat(stdout), err = Buffer.concat(stderr)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    if (outputTooLarge || result.exitCode !== 0 || result.spawnError) {
      const rawJson = join(scratch, `failed-${key}-${stamp}.stdout.txt`)
      const stderrFile = join(scratch, `failed-${key}-${stamp}.stderr.txt`)
      await mkdir(scratch, { recursive: true })
      await Promise.all([writeFile(rawJson, out), writeFile(stderrFile, err)])
      throw coded(outputTooLarge ? 'OUTPUT_LIMIT_EXCEEDED' : result.spawnError ? 'REA_SPAWN_FAILED' : 'REA_EXIT_NONZERO')
    }
    const preserveInvalidOutput = async suffix => {
      const rawJson = join(scratch, `failed-${key}-${stamp}.${suffix}.stdout.txt`)
      const stderrFile = join(scratch, `failed-${key}-${stamp}.${suffix}.stderr.txt`)
      await mkdir(scratch, { recursive: true })
      await Promise.all([writeFile(rawJson, out), writeFile(stderrFile, err)])
    }
    let evidence
    try { evidence = JSON.parse(out.toString('utf8')) } catch {
      await preserveInvalidOutput('invalid-json')
      throw coded('REA_OUTPUT_INVALID_JSON')
    }
    const invalidEvidence = evidenceError(evidence, context, procedure)
    if (invalidEvidence) {
      await preserveInvalidOutput('invalid-evidence')
      throw coded(invalidEvidence)
    }
    const entry = await storeEvidence(context, procedure, evidence, paths, 'query', result.durationMs, err.toString('utf8'))
    return completeSummary(procedure, entry, false)
  } finally { await releaseLock(paths.lock, ownerToken) }
}

async function importEvidence(context, file) {
  const source = inRepoRe(file)
  const bytes = await readFile(source).catch(() => { throw coded('IMPORT_UNREADABLE') })
  let evidence
  try { evidence = JSON.parse(bytes.toString('utf8')) } catch { throw coded('IMPORT_INVALID_JSON') }
  let procedure
  try { procedure = normalizeProcedure(evidence?.parameters?.procedure) } catch { throw coded('IMPORT_PROCEDURE_MISSING') }
  const error = evidenceError(evidence, context, procedure)
  if (error) throw coded(`IMPORT_${error}`)
  const key = cacheKey(context, procedure), paths = cachePaths(key)
  const ownerToken = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  await acquireLock(paths.lock, { pid: process.pid, childPid: null, ownerToken, procedure, cacheKey: key,
    startedAt: new Date().toISOString(), mode: 'import' })
  try {
    await mkdir(scratch, { recursive: true })
    await copyFile(source, paths.raw)
    await writeFile(paths.stderr, '')
    const entry = { schemaVersion: 1, cacheKey: key, createdAt: new Date().toISOString(), source: 'import', procedure,
      target: { path: context.exe, sha256: context.targetHash }, tool: context.tool, rawJson: rel(paths.raw),
      stderr: rel(paths.stderr), durationMs: null, importedFrom: rel(source), evidence }
    await writeProof(rel(paths.entry), entry)
    return completeSummary(procedure, entry, false)
  } finally { await releaseLock(paths.lock, ownerToken) }
}

async function status(context, procedures) {
  await mkdir(cacheDir, { recursive: true })
  await mkdir(lockDir, { recursive: true })
  const selected = procedures.length ? procedures : null
  const keys = selected?.map(procedure => ({ procedure, key: cacheKey(context, procedure) }))
  const entries = keys ?? (await readdir(cacheDir)).filter(name => /^entry-[a-f0-9]{64}\.json$/i.test(name)).map(name => ({ file: name }))
  const cache = []
  for (const item of entries) {
    const path = item.file ? join(cacheDir, item.file) : cachePaths(item.key).entry
    const fileStat = await stat(path).catch(() => null)
    if (!fileStat) {
      if (item.key) cache.push({ procedure: item.procedure, state: 'missing', file: rel(path) })
      continue
    }
    const parsed = await readJson(path)
    if (!parsed) { cache.push({ procedure: item.procedure ?? null, state: 'invalid', file: rel(path) }); continue }
    let normalizedProcedure
    try { normalizedProcedure = normalizeProcedure(parsed.procedure) } catch { normalizedProcedure = null }
    const expectedKey = normalizedProcedure ? cacheKey(context, normalizedProcedure) : null
    const filenameKey = /^entry-([a-f0-9]{64})\.json$/i.exec(basename(path))?.[1]?.toLowerCase() ?? null
    const targetMatches = normPath(parsed.target?.path ?? '') === normPath(context.exe) &&
      String(parsed.target?.sha256 ?? '').toLowerCase() === context.targetHash
    const storedKey = normalizedProcedure && parsed.target?.sha256 && parsed.tool
      ? cacheKey({ targetHash: parsed.target.sha256, tool: parsed.tool }, normalizedProcedure) : null
    const evidenceIssue = normalizedProcedure && parsed.target && parsed.tool && parsed.evidence
      ? evidenceError(parsed.evidence, { exe: parsed.target.path, targetHash: parsed.target.sha256,
        tool: parsed.tool }, normalizedProcedure) : 'CACHE_EVIDENCE_MISSING'
    const structuralError = parsed.schemaVersion !== 1 || !normalizedProcedure || !targetMatches ||
      !parsed.tool?.provider || !parsed.tool?.rea || parsed.cacheKey !== filenameKey ||
      parsed.cacheKey !== storedKey || !!evidenceIssue
    const current = parsed.cacheKey === expectedKey
    cache.push({ procedure: normalizedProcedure ?? parsed.procedure ?? item.procedure ?? null,
      state: structuralError ? 'invalid' : current ? 'cached' : 'other-identity',
      evidenceId: parsed.evidence?.evidence_id ?? null, cacheKey: parsed.cacheKey ?? null, file: rel(path) })
  }
  const locks = []
  for (const name of (await readdir(lockDir)).filter(name => /^query-[a-f0-9]{64}\.json$/i.test(name))) {
    const path = join(lockDir, name), state = await lockStatus(path)
    if (!selected || selected.some(procedure => cachePaths(cacheKey(context, procedure)).lock === path))
      locks.push({ ...state, file: rel(path) })
  }
  const invalidCache = cache.some(item => item.state === 'invalid')
  return { ok: !invalidCache, targetSha256: context.targetHash, provider: context.tool.provider,
    rea: { version: context.tool.rea.version, cliSha256: context.tool.rea.cliSha256 }, cache, locks }
}

function parseArgs(args) {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) return { mode: 'help' }
  if (args[0] === '--status') return { mode: 'status', procedures: args.slice(1).map(normalizeProcedure) }
  if (args[0] === '--import') {
    if (args.length !== 2) throw coded('IMPORT_USAGE')
    return { mode: 'import', file: args[1] }
  }
  const refresh = args[0] === '--refresh'
  const rawProcedures = refresh ? args.slice(1) : args
  if (!rawProcedures.length || rawProcedures.some(arg => arg.startsWith('--'))) throw coded('QUERY_USAGE')
  return { mode: 'query', refresh, procedures: [...new Set(rawProcedures.map(normalizeProcedure))] }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.mode === 'help') { console.log(usage); return }
  const context = await setup()
  if (args.mode === 'status') {
    const result = await status(context, args.procedures)
    console.log(JSON.stringify(result))
    if (!result.ok) process.exitCode = 1
    return
  }
  if (args.mode === 'import') {
    const result = await importEvidence(context, args.file)
    console.log(JSON.stringify(result))
    return
  }
  const results = []
  for (const procedure of args.procedures) {
    try { results.push(await cachedQuery(context, procedure, args.refresh)) }
    catch (error) { results.push({ ok: false, procedure, error: safeCode(error?.code) }); break }
  }
  console.log(JSON.stringify({ ok: results.length === args.procedures.length && results.every(result => result.ok), results }))
  if (results.some(result => !result.ok)) process.exitCode = 1
}

main().catch(error => {
  console.log(JSON.stringify({ ok: false, error: safeCode(error?.code) }))
  process.exitCode = 1
})
