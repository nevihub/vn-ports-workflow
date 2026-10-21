import { createWriteStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { execFileSync, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const slash = value => value.split(sep).join('/')

function packageInfo(directory) {
  try { return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) } catch { return null }
}

function packageCli(directory, name) {
  const info = packageInfo(directory)
  const binary = typeof info?.bin === 'string' ? info.bin : info?.bin?.[name === 'typescript' ? 'tsc' : basename(name)]
  if (!binary || !existsSync(join(directory, binary))) throw new Error(`Installed CLI unavailable: ${name}`)
  return join(directory, binary)
}

export function localCli(name) {
  return packageCli(join(root, 'node_modules', name), name)
}

// Reuse installed tooling without letting npx fetch a different release on each run.
export function findCachedPackage(name) {
  const local = join(root, 'node_modules', name)
  if (packageInfo(local)) return local
  const caches = [process.env.npm_config_cache,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'npm-cache'),
    process.platform === 'win32' ? join(homedir(), 'AppData/Local/npm-cache') : join(homedir(), '.npm')]
  const candidates = []
  for (const cache of new Set(caches.filter(Boolean))) {
    const directory = join(cache, '_npx')
    let entries
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { entries = [] }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(directory, entry.name, 'node_modules', name), info = packageInfo(path)
      if (!info) continue
      try { candidates.push({ path, version: info.version.split(/[.+-]/).slice(0, 3).map(Number), mtime: statSync(join(path, 'package.json')).mtimeMs }) } catch { /* inaccessible cache entry */ }
    }
  }
  candidates.sort((a, b) => {
    for (let i = 0; i < 3; i++) { const difference = (b.version[i] || 0) - (a.version[i] || 0); if (difference) return difference }
    return b.mtime - a.mtime
  })
  if (!candidates.length) throw new Error(`No installed ${name} package; install it once or configure its SAYA tool-path override`)
  return candidates[0].path
}

export function cachedCli(name) {
  const override = name === 'wrangler' ? process.env.GAME_WRANGLER_CLI : undefined
  if (override) {
    if (!existsSync(override)) throw new Error('GAME_WRANGLER_CLI does not exist')
    return resolve(override)
  }
  return packageCli(findCachedPackage(name), name)
}

function evidencePath(file) {
  const path = resolve(root, file)
  if (!path.startsWith(join(root, 're') + sep)) throw new Error('Evidence output must stay under the ignored re/ directory')
  return path
}

export async function writeProof(file, data) {
  const path = evidencePath(file), temporary = `${path}.${process.pid}.tmp`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(temporary, JSON.stringify(data, null, 2) + '\n')
  await rename(temporary, path)
  return slash(relative(root, path))
}

export function checkpoint() {
  try {
    const run = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return { head: run(['rev-parse', '--short', 'HEAD']), dirty: !!run(['status', '--porcelain']) }
  } catch { return { head: 'unknown', dirty: null } }
}

// Raw command output stays local; callers print only their structured summaries.
export async function runLogged(id, command, args = [], options = {}) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid step name')
  const path = evidencePath(options.log ?? `re/verification/automation-${id}.log`)
  await mkdir(dirname(path), { recursive: true })
  const started = Date.now(), output = createWriteStream(path, { flags: 'w' })
  return new Promise(resolveResult => {
    let error = null, timer
    const child = spawn(command, args, { cwd: root, windowsHide: true, shell: false,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'] })
    child.stdout.pipe(output, { end: false })
    child.stderr.pipe(output, { end: false })
    child.on('error', failure => { error = failure.code ?? failure.name })
    if (options.timeoutMs) timer = setTimeout(() => { error = 'TIMEOUT'; child.kill() }, options.timeoutMs)
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer)
      output.end(() => resolveResult({ id, exitCode, signal, error, durationMs: Date.now() - started,
        log: slash(relative(root, path)), ok: exitCode === 0 && !error }))
    })
    child.stdin.end(options.input)
  })
}
