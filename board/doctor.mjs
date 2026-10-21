#!/usr/bin/env node
// Environment preflight for a port checkout: `npm run doctor` in a game (its scripts/doctor.mjs runs this
// with --project/--root), or `node doctor.mjs --project saya` here. Read-only: it never writes, installs,
// launches a browser, or touches game data. Tiers: required (fail the run) vs recommended (warn, unless
// --strict promotes them). `--json` prints the machine-readable report for CI.
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateGameConfig } from './lib/game-config.mjs'
import { loadProjects } from './lib/projects.mjs'

const fail = msg => { console.error(`doctor: ${msg}`); process.exit(1) }

const argv = process.argv.slice(2)
const flags = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--') continue
  if (a.startsWith('--')) {
    const next = argv[i + 1]
    flags[a.slice(2)] = next !== undefined && !next.startsWith('--') ? argv[++i] : true
  } else fail(`unexpected argument ${a} (usage: doctor [--project <id>] [--root <dir>] [--strict] [--json])`)
}
const str = v => (typeof v === 'string' ? v : undefined)
if (flags.help === true || flags.h === true) {
  console.log('usage: doctor [--project <id>] [--root <dir>] [--strict] [--json]\n\nRead-only environment preflight for a game checkout (never writes or installs).')
  process.exit(0)
}

const projects = loadProjects()
const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
function findRoot () {
  if (str(flags.root)) return resolve(str(flags.root))
  let dir = process.cwd()
  for (;;) {
    if (existsSync(join(dir, 'docs', 'BACKLOG.md'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return projects.find(p => p.id === str(flags.project))?.root ?? null
}
const root = findRoot()
if (!root) fail('no game checkout here or above (run inside a game folder, or pass --root <dir>)')
const project = (str(flags.project) && projects.find(p => p.id === str(flags.project))) ||
  projects.find(p => p.root && root && norm(p.root) === norm(root)) || null
const strict = flags.strict === true || flags.strict === 'true'
const asJson = flags.json === true || flags.json === 'true'

const checks = []
const check = (id, tier, ok, detail) => checks.push({ id, tier, ok: !!ok, detail: detail ?? null })
const recommended = (id, ok, detail) => check(id, strict ? 'required' : 'recommended', ok, detail)

const run = (cmd, args, cwd) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', cwd: cwd ?? process.cwd(), stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim() } catch { return null }
}
const writable = dir => { try { accessSync(dir, constants.W_OK); return true } catch { return false } }

check('os', 'info', true, `${process.platform}-${process.arch}`)
const nodeMajor = Number(process.versions.node.split('.')[0])
check('node', 'required', nodeMajor >= 20, `${process.version} (need >= 20)`)
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// .cmd shims do not run without a shell, so prefer the npm bundled next to this node binary.
function npmVersion () {
  const bundled = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (existsSync(bundled)) return run(process.execPath, [bundled, '--version'])
  if (process.platform === 'win32') return run('cmd', ['/c', 'npm', '--version'])
  return run(NPM, ['--version'])
}
check('npm', 'required', npmVersion() !== null, npmVersion() ?? 'not on PATH')
check('git', 'required', run('git', ['--version']) !== null, run('git', ['--version']) ?? 'not on PATH')
check('ledger', 'required', existsSync(join(root, 'docs', 'BACKLOG.md')), 'docs/BACKLOG.md present')
check('checkout-writable', 'required', writable(root), root)

let gameId = null
try {
  const parsed = JSON.parse(readFileSync(join(root, 'game.config.json'), 'utf8'))
  const { errors, warnings } = validateGameConfig(parsed)
  gameId = parsed?.game?.id ?? null
  check('game-config', 'required', errors.length === 0,
    errors.length ? errors.join('; ') : (warnings.join('; ') || 'valid'))
} catch {
  check('game-config', 'required', false, 'missing or unparsable (scaffold it, then fill ticket R1)')
}
check('game-id', 'info', !!gameId, gameId ?? 'unknown')

const scriptsRequired = ['check-firewall.mjs']
const scriptsStaged = ['verify.mjs', 'deploy.mjs', 'check-deploy.mjs', 'split-archives.mjs']
for (const name of scriptsRequired) check(`script:${name}`, 'required', existsSync(join(root, 'scripts', name)), 'present')
for (const name of scriptsStaged) {
  const present = existsSync(join(root, 'scripts', name))
  recommended(`script:${name}`, present, present ? 'present' : 'missing (copy templates/scripts/ when the game reaches its stage)')
}
check('proof-dir', 'required', writable(join(root, 're')) || !existsSync(join(root, 're')) || writable(root),
  're/verification must be writable (ignored proof output)')

// Recommended: only the tooling a run actually needs. Absence warns; --strict fails.
const playwrightPath = process.env.GAME_PLAYWRIGHT_MODULE ?? null
recommended('playwright', !!playwrightPath || run(process.execPath, ['-e', 'require.resolve("playwright")'], root) !== null,
  playwrightPath ?? 'no GAME_PLAYWRIGHT_MODULE and no local playwright (browser proofs need one)')
recommended('wrangler', run('wrangler', ['--version']) !== null || !!process.env.GAME_WRANGLER_CLI,
  'deploy needs a cached wrangler (GAME_WRANGLER_CLI override supported)')
recommended('ffmpeg', run('ffmpeg', ['-version']) !== null, 'icon rendering needs ffmpeg')
recommended('ghidra', !!process.env.GHIDRA_INSTALL_DIR && existsSync(resolve(process.env.GHIDRA_INSTALL_DIR)),
  'RE queries need GHIDRA_INSTALL_DIR (ticket R1)')
recommended('java', run('java', ['-version']) !== null || !!process.env.JAVA_HOME, 'Ghidra needs a JDK 21+')
const dataPresent = existsSync(join(root, 'game-data'))
check('game-data', 'info', true, dataPresent ? 'present (must stay ignored; the firewall enforces it)' : 'absent (ticket U1: supply the install; scripts refuse placeholders until then)')

const failed = checks.filter(c => c.tier === 'required' && !c.ok)
const warned = checks.filter(c => c.tier !== 'required' && !c.ok)
const ok = failed.length === 0
const report = { ok, strict, root, project: project?.id ?? null,
  checks, failed: failed.map(c => c.id), warnings: warned.map(c => c.id) }
if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  for (const c of checks) {
    const mark = c.ok ? 'ok  ' : (c.tier === 'required' ? 'FAIL' : 'warn')
    console.log(`doctor ${mark} ${c.id}${c.detail ? ` - ${c.detail}` : ''}`)
  }
  console.log(`doctor ${ok ? 'READY' : 'NOT READY'} | ${checks.filter(c => c.ok).length}/${checks.length} checks | project ${report.project ?? '(unregistered)'} | ${strict ? '--strict' : 'advisory tooling ignored'}${warned.length ? ` | warnings: ${warned.map(c => c.id).join(', ')}` : ''}`)
}
if (!ok) process.exit(1)
