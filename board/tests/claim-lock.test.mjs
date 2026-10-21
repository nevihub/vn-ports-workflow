import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { CLAIM_TTL_MS, commonDir, lockFile, readLock, release, tryClaim } from '../lib/claim-lock.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
process.env.GIT_AUTHOR_NAME ??= 'lock-test'
process.env.GIT_AUTHOR_EMAIL ??= 'lock-test@example.com'
process.env.GIT_COMMITTER_NAME ??= 'lock-test'
process.env.GIT_COMMITTER_EMAIL ??= 'lock-test@example.com'

function gitRepo () {
  const root = mkdtempSync(join(tmpdir(), 'lock-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  return root
}

test('first claim wins, the second is refused with the holder named', () => {
  const root = gitRepo()
  const first = tryClaim(root, { project: 'saya', ticket: 'E5', owner: 'claude wt1', session: 'wt1' })
  assert.equal(first.ok, true, first.reason)
  assert.equal(first.takeover, false)
  const stored = readLock(lockFile(root, 'saya', 'E5'))
  assert.equal(stored.owner, 'claude wt1')
  assert.ok(stored.expiresAt - stored.at === CLAIM_TTL_MS, 'locks expire after the stale-claim window')
  const second = tryClaim(root, { project: 'saya', ticket: 'E5', owner: 'codex wt2', session: 'wt2' })
  assert.equal(second.ok, false)
  assert.match(second.reason, /claude wt1/, 'the refusal names the holder')
  assert.match(second.reason, /wt2|wt1|until/, 'and its session or expiry')
})

test('a forced claim takes over but returns the previous holder for the ledger note', () => {
  const root = gitRepo()
  tryClaim(root, { project: 'saya', ticket: 'E5', owner: 'claude wt1', session: 'wt1' })
  const forced = tryClaim(root, { project: 'saya', ticket: 'E5', owner: 'codex wt2', session: 'wt2', force: true })
  assert.equal(forced.ok, true)
  assert.equal(forced.takeover, true)
  assert.equal(forced.previous.owner, 'claude wt1')
  assert.equal(readLock(lockFile(root, 'saya', 'E5')).owner, 'codex wt2')
})

test('a stale lock is taken over without --force once its window passes', () => {
  const root = gitRepo()
  tryClaim(root, { project: 'saya', ticket: 'E6', owner: 'claude wt1', session: 'wt1', ttlMs: 1, now: 1000 })
  const next = tryClaim(root, { project: 'saya', ticket: 'E6', owner: 'codex wt2', session: 'wt2', now: 1000 + CLAIM_TTL_MS + 1 })
  assert.equal(next.ok, true, next.reason)
  assert.equal(next.takeover, true, 'stale takeovers are marked so the caller records them')
  assert.equal(next.previous.owner, 'claude wt1')
})

test('release frees the ticket; a foreign session cannot release it', () => {
  const root = gitRepo()
  tryClaim(root, { project: 'saya', ticket: 'E7', owner: 'claude wt1', session: 'wt1' })
  assert.equal(release(root, { project: 'saya', ticket: 'E7', session: 'wt2' }), false, 'wrong session keeps the lock')
  assert.equal(release(root, { project: 'saya', ticket: 'E7', session: 'wt1', owner: 'someone else' }), false, 'wrong owner keeps the lock')
  assert.equal(release(root, { project: 'saya', ticket: 'E7', session: 'wt1', owner: 'claude wt1' }), true)
  const again = tryClaim(root, { project: 'saya', ticket: 'E7', owner: 'codex wt2', session: 'wt2' })
  assert.equal(again.ok, true, again.reason)
  assert.equal(again.takeover, false, 'a released lock is a fresh claim, not a takeover')
})

test('outside git there is nothing to arbitrate through: claims skip locking openly', () => {
  const root = mkdtempSync(join(tmpdir(), 'lock-nogit-'))
  assert.equal(commonDir(root), null)
  assert.equal(lockFile(root, 'saya', 'E5'), null)
  const r = tryClaim(root, { project: 'saya', ticket: 'E5', owner: 'a', session: 'b' })
  assert.equal(r.ok, true)
  assert.equal(r.skipped, true, 'the skip is recorded, not silent')
})

function raceOnce (root, tag) {
  const code = `import { tryClaim } from ${JSON.stringify(pathToFileURL(join(HERE, '..', 'lib', 'claim-lock.mjs')).href)};` +
    `const r = tryClaim(process.env.RACE_ROOT, { project: 'race', ticket: 'E1', owner: process.env.RACE_OWNER, session: process.env.RACE_OWNER });` +
    `console.log(JSON.stringify({ ok: r.ok }))`
  const run = owner => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code],
      { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RACE_ROOT: root, RACE_OWNER: owner } })
    let out = ''
    child.stdout.on('data', d => { out += d })
    child.on('error', reject)
    child.on('close', status => status === 0 ? resolve(out) : reject(new Error(`${owner} exited ${status}: ${out}`)))
  })
  return Promise.all([run(`a-${tag}`), run(`b-${tag}`)])
}

test('two processes racing the same ticket produce exactly one winner', async () => {
  for (const round of [1, 2]) {
    const root = gitRepo()
    const [a, b] = await raceOnce(root, round)
    const wins = [JSON.parse(a).ok, JSON.parse(b).ok].filter(Boolean).length
    assert.equal(wins, 1, `round ${round}: exactly one winner (a=${a.trim()} b=${b.trim()})`)
  }
})
