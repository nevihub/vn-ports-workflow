// Per-game config loader for game repos (standalone: game checkouts cannot import board code).
// Every template script that touches game-specific values (archive extensions, archive names, ports, project,
// cache names, exe names, expected counts) reads game.config.json through here instead of hard-coding them.
// Keep the validation rules in sync with board/lib/game-config.mjs (the hygiene test asserts they agree).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const GAME_CONFIG_VERSION = 1

const ID_RE = /^[a-z][a-z0-9-]{1,30}$/
const EXT_RE = /^[a-z0-9_]{1,8}$/

export const isPlaceholder = value => {
  if (value === null || value === undefined) return true
  const s = String(value).trim()
  return s === '' || /^<.*>$/.test(s) || /example\.com/i.test(s) || /__TODO__|TODO/i.test(s)
}

const str = v => (typeof v === 'string' ? v : undefined)

// Same rules as the board schema: errors refuse to run, warnings are fine outside production paths.
export function validateGameConfig (cfg, { strict = false } = {}) {
  const errors = [], warnings = []
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { errors: ['game.config.json must be a JSON object'], warnings }
  if (cfg.version !== GAME_CONFIG_VERSION) errors.push(`game.config.json version must be ${GAME_CONFIG_VERSION}`)
  const game = cfg.game ?? {}
  if (!ID_RE.test(str(game.id) ?? '')) errors.push('game.id: lowercase letters, digits and -, e.g. "sengoku"')
  if (!str(game.title)?.trim() || isPlaceholder(game.title)) errors.push('game.title: the human-readable title (no placeholders)')
  if (!str(game.engine)?.trim()) warnings.push('game.engine is empty: name the engine once R1 identifies it')
  if (isPlaceholder(game.edition)) warnings.push('game.edition is a placeholder: record the owned edition (ticket U1)')
  const runtime = cfg.runtime ?? {}
  if (!['wasm', 'vm', 'convert', 'unknown'].includes(runtime.strategy)) errors.push(`runtime.strategy must be one of wasm, vm, convert, unknown`)
  const content = cfg.content ?? {}
  const exts = content.archiveExtensions
  if (!Array.isArray(exts) || !exts.length || !exts.every(e => EXT_RE.test(str(e)?.replace(/^\./, '') ?? ''))) {
    errors.push('content.archiveExtensions: non-empty list like ["npa"] or ["arc"] (ticket R1 fills this in)')
  }
  if (!Array.isArray(content.archiveNames) || !content.archiveNames.length || !content.archiveNames.every(n => /^[a-z0-9_-]{1,40}$/i.test(str(n) ?? ''))) {
    (strict ? errors : warnings).push('content.archiveNames: expected archives without extension, e.g. ["cg", "sound"] (ticket R1 fills this in)')
  }
  if (content.archiveMagic !== undefined && content.archiveMagic !== null &&
      !(typeof content.archiveMagic === 'string' && /^[0-9a-fA-F]{4,64}$/.test(content.archiveMagic))) {
    errors.push('content.archiveMagic: even-length hex of the archive header, or null when the engine has none')
  }
  if (!Array.isArray(content.scriptExtensions) || !content.scriptExtensions.every(e => EXT_RE.test(str(e)?.replace(/^\./, '') ?? ''))) {
    errors.push('content.scriptExtensions must be a list (possibly empty) like ["nss"]')
  }
  const count = content.expectedScriptCount
  if (count !== null && count !== undefined && (!Number.isSafeInteger(count) || count < 1)) {
    errors.push('content.expectedScriptCount must be a positive integer or null (unknown until S1)')
  }
  const qa = cfg.qa ?? {}
  if (cfg.qa !== undefined && cfg.qa !== null && (typeof cfg.qa !== 'object' || Array.isArray(cfg.qa))) {
    errors.push('qa must be an object or absent (optional title-screen assertions)')
  } else {
    if (qa.titleChoices !== undefined && qa.titleChoices !== null && (!Number.isSafeInteger(qa.titleChoices) || qa.titleChoices < 1)) {
      errors.push('qa.titleChoices must be a positive integer or null (unknown until the title boots)')
    }
    if (qa.titleRoutine !== undefined && qa.titleRoutine !== null && (!str(qa.titleRoutine)?.trim() || isPlaceholder(qa.titleRoutine))) {
      (strict ? errors : warnings).push('qa.titleRoutine is a placeholder: the title-screen routine name once the title boots')
    }
  }
  const build = cfg.build ?? {}
  if (!Number.isSafeInteger(build.devPort) || build.devPort < 1024 || build.devPort > 65535) {
    errors.push('build.devPort must be a port number 1024-65535')
  }
  if (!Number.isSafeInteger(build.partSizeBytes) || build.partSizeBytes < 65536) {
    errors.push('build.partSizeBytes must be an integer >= 65536')
  }
  for (const [key, label] of [['renderWidth', 'build.renderWidth'], ['renderHeight', 'build.renderHeight']]) {
    const v = build[key]
    if (v !== undefined && v !== null && (!Number.isSafeInteger(v) || v < 1)) errors.push(`${label} must be a positive integer or absent`)
  }
  const deploy = cfg.deploy ?? {}
  if (strict) {
    if (isPlaceholder(deploy.project)) errors.push('deploy.project is a placeholder: set the production hosting project before deploying')
    if (isPlaceholder(deploy.domain)) errors.push('deploy.domain is a placeholder: set the production domain before deploying')
  } else {
    if (isPlaceholder(deploy.project)) warnings.push('deploy.project is a placeholder: production deploy refuses until it is set')
    if (isPlaceholder(deploy.domain)) warnings.push('deploy.domain is a placeholder: production deploy refuses until it is set')
  }
  return { errors, warnings }
}

export function loadGameConfig (root, { strict = false } = {}) {
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(join(root, 'game.config.json'), 'utf8'))
  } catch {
    return { config: null, errors: ['game.config.json is missing or unparsable: copy the scaffold skeleton, then fill ticket R1'], warnings: [] }
  }
  const { errors, warnings } = validateGameConfig(parsed, { strict })
  return { config: parsed, errors, warnings }
}

// Production paths (deploy, live smoke): placeholders refuse to run. Dev-loop scripts use production: false.
export function requireGameConfig (root, { production = false } = {}) {
  const { config, errors, warnings } = loadGameConfig(root, { strict: production })
  for (const w of warnings) console.warn(`game.config.json: ${w}`)
  if (!config || errors.length) {
    throw new Error(`GAME_NOT_CONFIGURED: ${errors.join('; ') || 'unreadable'} (fill game.config.json, tickets R1/U1)`)
  }
  if (production) assertDeployable(config)
  return config
}

export function assertDeployable (config) {
  const { errors } = validateGameConfig(config, { strict: true })
  const blocking = errors.filter(e => e.startsWith('deploy.') || e.startsWith('content.archive') || e.startsWith('game.'))
  if (blocking.length) throw new Error(`DEPLOY_UNCONFIGURED: ${blocking.join('; ')} (fill game.config.json, tickets R1/U1)`)
}

const cleanExt = e => String(e).replace(/^\./, '').toLowerCase()

// Derived names every script builds the same way: cache prefix, block suffix, exe leaf, dev origin.
export function derived (config) {
  const id = config.game.id
  const exts = (config.content.archiveExtensions ?? []).map(cleanExt)
  const ext = exts[0] ?? null
  const archives = [...(config.content.archiveNames ?? [])].sort()
  const exePath = config.native?.exePath ?? null
  const exeName = exePath && !isPlaceholder(exePath) ? exePath.split(/[\\/]/).pop() : null
  const sha256 = config.native?.sha256 && !isPlaceholder(config.native.sha256) ? config.native.sha256 : null
  return {
    id, ext, exts, archives, exeName, sha256,
    partSize: config.build.partSizeBytes,
    devPort: config.build.devPort,
    devOrigin: `http://127.0.0.1:${config.build.devPort}`,
    renderWidth: config.build.renderWidth ?? null,
    renderHeight: config.build.renderHeight ?? null,
    project: isPlaceholder(config.deploy?.project) ? null : config.deploy.project,
    branch: config.deploy?.branch ?? 'main',
    domain: isPlaceholder(config.deploy?.domain) ? null : config.deploy.domain,
    cacheName: `${id}-game-v1`,
    expectedScriptCount: config.content.expectedScriptCount ?? null,
    scriptExt: (config.content.scriptExtensions ?? []).map(cleanExt)[0] ?? null,
    archiveMagic: config.content.archiveMagic ?? null,
    titleChoices: config.qa?.titleChoices ?? null,
    titleRoutine: config.qa?.titleRoutine && !isPlaceholder(config.qa.titleRoutine) ? config.qa.titleRoutine : null,
  }
}
