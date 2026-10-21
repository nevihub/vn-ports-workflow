// Maintainer summary: what the background sweep watches, derived from data collect() already loads.
// Pure (no git, no channel reads) so tests can cover it without touching real state.
// "Thinking" = the maintainer's own recent channel notes (posted by the sweep script).
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

const statusCache = new Map()
const canonical = root => { try { return realpathSync.native(root) } catch { return resolve(root) } }

export function gitStatus (root, { maxAgeMs = 0, now = Date.now() } = {}) {
  if (!root) return { raw: '', at: now }
  const key = canonical(root)
  const hit = statusCache.get(key)
  if (hit && maxAgeMs > 0 && now - hit.at < maxAgeMs) return hit
  let raw = ''
  try { raw = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch {}
  const entry = { raw, at: now }
  if (maxAgeMs > 0) statusCache.set(key, entry)
  else statusCache.delete(key)
  return entry
}

export function clearGitStatusCache (root = null) {
  if (root) statusCache.delete(canonical(root))
  else statusCache.clear()
}

export function summarizeMaintainer ({ items = [], messages = [] } = {}) {
  const mergeQueue = items
    .filter(i => i.notMerged && i.state === 'done' && !i.ghost)
    .map(i => ({ id: i.id, worktree: i.worktree ?? null, branch: i.branch ?? null, owner: i.owner ?? null, at: i.at ?? null }))
  const seen = new Set()
  const ghosts = items
    .filter(i => i.ghost)
    .filter(i => !seen.has(i.id) && (seen.add(i.id), true))
    .map(i => ({ id: i.id, worktree: i.worktree ?? null, branch: i.branch ?? null, state: i.state ?? null }))
  const stale = items
    .filter(i => i.staleHours != null)
    .map(i => ({ id: i.id, staleHours: i.staleHours, owner: i.owner ?? null }))
  // collect() passes messages newest-first; keep the newest maintainer notes.
  const thinking = messages
    .filter(m => /maintainer/i.test(m.by ?? '') || /^maintainer sweep/i.test(m.text ?? ''))
    .slice(0, 5)
  return { mergeQueue, ghosts, stale, thinking, lastSweepAt: thinking[0]?.at ?? null }
}

// Nudges: a claimed card gone quiet for longer than nudgeAfterHours gets one polite
// question posted on its card (kind question + ticket, so the owner sees it in their inbox).
// Pure: callers pass audit findings + already-read channel messages. Anti-nag: a card
// with a maintainer nudge already in the message window is never nudged twice.
export const NUDGE_AFTER_HOURS = 4

export function parseStaleClaim (f = {}) {
  if (f.code !== 'stale-claim') return null
  const m = String(f.text ?? '').match(/^(\S+)\s+claimed by\s+(.+?)\s+with no update for\s+(\d+)\s*h\b/)
  if (!m) return null
  return { id: String(f.id ?? m[1]).toUpperCase(), owner: m[2], staleHours: Number(m[3]) }
}

export function buildNudges ({ findings = [], messages = [], nudgeAfterHours = NUDGE_AFTER_HOURS } = {}) {
  const nudged = new Set(messages
    .filter(m => /maintainer nudge/i.test(m.text ?? ''))
    .map(m => String(m.ticket ?? '').toUpperCase()))
  const out = []
  for (const f of findings) {
    const s = parseStaleClaim(f)
    if (!s || s.staleHours < nudgeAfterHours || nudged.has(s.id)) continue
    out.push({ ...s, kind: 'question',
      text: `maintainer nudge: ${s.id} claimed by ${s.owner}, no update for ${s.staleHours}h. Still on it? Post progress (\`npm run issue -- progress ${s.id} --percent N \"...\"\`) so the board stays honest, or drop it so someone else can start.`.slice(0, 590) })
  }
  return out
}

// Read-only git peek at a project's main checkout (dirty files, not content).
export function dirtyCheckout (root, { maxAgeMs = 0, now = Date.now(), statusRaw = undefined } = {}) {
  if (!root) return { count: 0, lines: [] }
  const out = statusRaw ?? gitStatus(root, { maxAgeMs, now }).raw
  if (!out) return { count: 0, lines: [] }
  const lines = out.split('\n').filter(Boolean)
  return { count: lines.length, lines: lines.slice(0, 8) }
}
