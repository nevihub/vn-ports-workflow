// Checker lock: the files that judge the work (firewalls, verifiers, proof harnesses, progress checklists) are hashed
// into VN-Ports/oracles.lock.json (tracked by the root repo, outside every game repo). The audit flags any checker
// that changed since the lock, so an agent cannot quietly pass by loosening its own test (the MW2 decompilation
// agents kept editing the comparison script to skip their functions). Only the user re-locks
// (`npm run issue -- oracle-lock --by user`), and every re-lock is posted to the agent channel and shown on the board.
// Patterns per game in projects.json "oracles": paths relative to the game folder or absolute; `*` matches within
// the last path segment only.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { VN_ROOT } from './knowledge.mjs'

export const LOCK_FILE = join(VN_ROOT, 'oracles.lock.json')
const RECENT_MS = 24 * 3600_000

const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 16)
const norm = p => p.replace(/\\/g, '/')

export function expand (patterns, root) {
  const files = new Set()
  for (const pat of patterns ?? []) {
    const full = norm(isAbsolute(pat) ? pat : join(root, pat))
    const dir = dirname(full), base = basename(full)
    if (!base.includes('*')) { if (existsSync(full)) files.add(full); continue }
    const re = new RegExp(`^${base.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i')
    let names = []
    try { names = readdirSync(dir) } catch {}
    for (const n of names) if (re.test(n)) files.add(`${dir}/${n}`)
  }
  return [...files].sort()
}

export function snapshot (project) {
  if (!project?.root || !project.oracles?.length) return {}
  const out = {}
  for (const f of expand(project.oracles, project.root)) {
    const key = f.startsWith(norm(project.root) + '/') ? f.slice(norm(project.root).length + 1) : f
    out[key] = hash(f)
  }
  return out
}

export const readLock = (file = LOCK_FILE) => { try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return { projects: {} } } }

export function lock (project, by, { file = LOCK_FILE, now = Date.now() } = {}) {
  const all = readLock(file)
  all.projects ??= {}
  const files = snapshot(project)
  all.projects[project.id] = { lockedAt: new Date(now).toISOString(), by, files }
  writeFileSync(file, JSON.stringify(all, null, 2) + '\n')
  return Object.keys(files).length
}

// Audit findings for one game (same shape as lib/audit.mjs).
export function oracleFindings (project, { file = LOCK_FILE, now = Date.now() } = {}) {
  if (!project?.oracles?.length || !project.root) return []
  const entry = readLock(file).projects?.[project.id]
  if (!entry) return [{ level: 'check', code: 'oracle-unlocked', id: null, text: `the checkers (${project.oracles.length} patterns) are not locked yet - ask the user to run the lock`, suggest: 'npm run issue -- oracle-lock --by user   (the user only)' }]
  const cur = snapshot(project)
  const out = []
  for (const [f, h] of Object.entries(entry.files)) {
    if (!(f in cur)) out.push({ level: 'fix', code: 'oracle-deleted', id: null, text: `checker ${f} was deleted after the lock - restore it or get the user's OK`, suggest: null })
    else if (cur[f] !== h) out.push({ level: 'fix', code: 'oracle-changed', id: null, text: `checker ${f} changed after the lock (${entry.lockedAt.slice(0, 16)}) - a change to what judges the work needs the user's OK; revert it or ask`, suggest: `git diff -- "${f}"` })
  }
  for (const f of Object.keys(cur)) {
    if (!(f in entry.files)) out.push({ level: 'info', code: 'oracle-new', id: null, text: `new checker ${f} is not in the lock yet (the user locks it)`, suggest: null })
  }
  const at = Date.parse(entry.lockedAt)
  if (at && now - at < RECENT_MS && entry.by && !/^user\b/i.test(entry.by)) {
    out.push({ level: 'check', code: 'oracle-relocked', id: null, text: `the checker lock was renewed by ${entry.by} (not the user) at ${entry.lockedAt.slice(0, 16)}`, suggest: null })
  }
  return out
}
