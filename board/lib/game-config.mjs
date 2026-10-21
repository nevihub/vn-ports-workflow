// Per-game configuration for ported projects: one validated `game.config.json` per game repo so
// reusable scripts never hard-code another game's project names, archive layouts, ports or counts.
// Templates read it with a tiny local loader (they cannot import board code); the board validates it
// here (scaffold writes it, doctor checks it, CI enforces the schema).
export const GAME_CONFIG_VERSION = 1

const ID_RE = /^[a-z][a-z0-9-]{1,30}$/
export const EXT_RE = /^[a-z0-9_]{1,8}$/
const STRATEGIES = ['wasm', 'vm', 'convert', 'unknown']

export const isPlaceholder = value => {
  if (value === null || value === undefined) return true
  const s = String(value).trim()
  return s === '' || /^<.*>$/.test(s) || /example\.com/i.test(s) || /__TODO__|TODO/i.test(s)
}

const str = v => (typeof v === 'string' ? v : undefined)

// Validate a parsed game.config.json. Returns { errors, warnings }; strict=true is for production
// operations (deploy, live smoke): placeholders in deploy/content/build refuse to run.
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
  if (!STRATEGIES.includes(runtime.strategy)) errors.push(`runtime.strategy must be one of ${STRATEGIES.join(', ')}`)
  const content = cfg.content ?? {}
  const exts = content.archiveExtensions
  if (!Array.isArray(exts) || !exts.length || !exts.every(e => EXT_RE.test(str(e)?.replace(/^\./, '') ?? ''))) {
    errors.push('content.archiveExtensions: non-empty list like ["npa"] or ["arc"] (ticket R1 fills this in)')
  }
  if (!Array.isArray(content.archiveNames) || !content.archiveNames.length || !content.archiveNames.every(n => /^[a-z0-9_-]{1,40}$/i.test(str(n) ?? ''))) {
    (strict ? errors : warnings).push('content.archiveNames: expected archives without extension, e.g. ["cg", "sound"] (ticket R1 fills this in)')
  }
  if (!Array.isArray(content.scriptExtensions) || !content.scriptExtensions.every(e => EXT_RE.test(str(e)?.replace(/^\./, '') ?? ''))) {
    errors.push('content.scriptExtensions must be a list (possibly empty) like ["nss"]')
  }
  const count = content.expectedScriptCount
  if (count !== null && count !== undefined && (!Number.isSafeInteger(count) || count < 1)) {
    errors.push('content.expectedScriptCount must be a positive integer or null (unknown until S1)')
  }
  const build = cfg.build ?? {}
  if (!Number.isSafeInteger(build.devPort) || build.devPort < 1024 || build.devPort > 65535) {
    errors.push('build.devPort must be a port number 1024-65535')
  }
  if (!Number.isSafeInteger(build.partSizeBytes) || build.partSizeBytes < 65536) {
    errors.push('build.partSizeBytes must be an integer >= 65536')
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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function loadGameConfig (root, { strict = false } = {}) {
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(join(root, 'game.config.json'), 'utf8'))
  } catch {
    return { config: null, errors: ['game.config.json is missing or unparsable: scaffold it with npm run new-port, then fill ticket R1'], warnings: [] }
  }
  const { errors, warnings } = validateGameConfig(parsed, { strict })
  return { config: parsed, errors, warnings }
}

// Throw an actionable error when production values are missing or still placeholders.
export function assertDeployable (config) {
  const { errors } = validateGameConfig(config, { strict: true })
  const blocking = errors.filter(e => e.startsWith('deploy.') || e.startsWith('content.archive'))
  if (blocking.length) throw new Error(`DEPLOY_UNCONFIGURED: ${blocking.join('; ')} (fill game.config.json, tickets R1/U1)`)
}
