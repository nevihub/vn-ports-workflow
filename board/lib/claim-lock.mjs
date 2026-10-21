// Cross-checkout claim locks: exactly one winner via O_EXCL file creation under the shared git
// common dir (every worktree of a repo shares it, even when checkouts live far apart). A lock names
// owner + session + expiry; a stale lock (past expiry, default 2 h to match the stale-claim window)
// may be taken over deliberately, never silently. Non-git checkouts cannot lock: they fail open with
// a recorded skip, because two such checkouts share nothing to arbitrate through.
import { execFileSync } from 'node:child_process'
import { mkdirSync, openSync, closeSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const CLAIM_TTL_MS = 2 * 60 * 60 * 1000
const DIR_NAME = 'vn-ports-claims'

// The repo every worktree shares. Null outside git (or when git cannot run).
export function commonDir (root) {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim()
    return out || null
  } catch { return null }
}

export function lockDir (root) {
  const common = commonDir(root)
  if (!common) return null
  const dir = join(root, common, DIR_NAME)
  mkdirSync(dir, { recursive: true })
  return dir
}

const safe = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'x'
export function lockFile (root, projectId, ticketId) {
  const dir = lockDir(root)
  if (!dir) return null
  return join(dir, `${safe(projectId)}-${safe(ticketId)}.json`)
}

export function readLock (path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

const expired = (lock, now) => !lock || !Number.isFinite(lock.expiresAt) || lock.expiresAt <= now

// Exactly one winner: the file is created O_EXCL, so two racers cannot both succeed. A stale lock
// (or a forced claim) is unlinked and the creation retried; the loser of the retry reads the winner.
// Every takeover returns the previous holder so the caller can record it in the ledger - never silent.
export function tryClaim (root, { project, ticket, owner, session, ttlMs = CLAIM_TTL_MS, force = false, now = Date.now() } = {}) {
  const path = lockFile(root, project, ticket)
  if (!path) return { ok: true, skipped: true, reason: 'no git common dir: single-checkout claim, no cross-checkout lock' }
  const lock = { project, ticket, owner, session, at: now, expiresAt: now + ttlMs }
  const create = () => {
    let fd = -1
    try {
      fd = openSync(path, 'wx', 0o644)
    } catch (e) {
      if (e?.code !== 'EEXIST') return { error: `claim lock not writable: ${e?.code ?? e?.message}` }
      return { exists: true }
    }
    try { writeFileSync(fd, JSON.stringify(lock, null, 2) + '\n') } finally { try { closeSync(fd) } catch {} }
    return { created: true }
  }
  const first = create()
  if (first.created) return { ok: true, lock, takeover: false }
  if (first.error) return { ok: false, reason: first.error }
  const holder = readLock(path)
  if (!expired(holder, now) && !force) {
    return { ok: false, holder, reason: `held by ${holder?.owner ?? '?'} (${holder?.session ?? '?'}) until ${new Date(holder?.expiresAt ?? now).toISOString()}` }
  }
  // Stale (or forced): take over deliberately, but keep the atomic retry so a simultaneous
  // racer still produces exactly one winner.
  try { unlinkSync(path) } catch {}
  const second = create()
  if (second.created) return { ok: true, lock, takeover: true, previous: holder }
  if (second.error) return { ok: false, reason: second.error }
  const winner = readLock(path)
  return { ok: false, holder: winner, reason: winner ? `lost the race to ${winner.owner ?? '?'} (${winner.session ?? '?'})` : 'lost the race (lock unreadable)' }
}

// Release only what this session holds; closing a ticket releases any lock (see issue.mjs done/drop/reopen).
export function release (root, { project, ticket, session, owner } = {}) {
  const path = lockFile(root, project, ticket)
  if (!path) return false
  const holder = readLock(path)
  if (!holder) return false
  if (session !== undefined && holder.session !== session) return false
  if (owner !== undefined && holder.owner !== owner) return false
  try { unlinkSync(path); return true } catch { return false }
}
