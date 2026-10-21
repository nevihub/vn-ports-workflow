import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync, utimesSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { cachedPage, pageCacheSize } from '../lib/page-cache.mjs'
import { documentSizeFinding, measureDocument, currentStateFiles } from '../lib/document-size.mjs'
import { evictParsedLedger, parsedLedger, parsedLedgerCacheSize } from '../lib/ledger-cache.mjs'
import { clearGitStatusCache, gitStatus } from '../lib/maintainer.mjs'
import { completeAudit, loadProjectState } from '../lib/project-state.mjs'
import { worktrees } from '../lib/worktrees.mjs'
import { collect } from '../board.mjs'
import { oracleFindings, snapshot as oracleSnapshot } from '../lib/oracles.mjs'

const fixture = prefix => mkdtempSync(join(tmpdir(), prefix))
const removeFixture = path => {
  const base = resolve(tmpdir()) + sep
  const target = resolve(path)
  if (!target.startsWith(base)) throw new Error('refusing to remove a test path outside the temporary directory')
  rmSync(target, { recursive: true, force: true })
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true })
const ledger = state => [
  '# Backlog', '', '## Timeline', '', '### [S1] Stage', 'Tickets: E1', 'Weight: 100', 'Playable: yes',
  '', '## Lanes', '', '### Lane E', '', '### [E1] Ticket', 'Plain: test', 'Gate: test', 'Status: ' + state, '',
].join('\n')

function repoFixture () {
  const root = fixture('vn-workflow-cache-')
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), ledger('OPEN'))
  writeFileSync(join(root, 'README.md'), 'clean\n')
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.email', 'fixture@example.invalid')
  git(root, 'config', 'user.name', 'Fixture')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'fixture baseline')
  return root
}

test('document sizing normalizes CRLF, excludes one final empty line, and counts UTF-8 bytes', () => {
  assert.deepEqual(measureDocument('x\r\n'.repeat(60)), { lines: 60, bytes: 119 })
  assert.deepEqual(measureDocument('é'), { lines: 1, bytes: 2 })
  const exact = ['a'.repeat(4382), ...Array(59).fill('a')].join('\n')
  assert.deepEqual(measureDocument(exact), { lines: 60, bytes: 4500 })
  assert.equal(documentSizeFinding('fixture/HANDOFF.md', exact), null)
  assert.equal(documentSizeFinding('fixture/HANDOFF.md', exact + 'a')?.code, 'document-size')
  assert.equal(documentSizeFinding('fixture/HANDOFF.md', exact + '\na')?.code, 'document-size')
})

test('current-state size checks include only handoff/status files and report measured counts', () => {
  const root = fixture('vn-workflow-docs-')
  try {
    writeFileSync(join(root, 'HANDOFF.md'), 'x\n'.repeat(61))
    writeFileSync(join(root, 'STATUS.md'), 'ok\n')
    const project = { id: 'fixture', root }
    const files = currentStateFiles(project, { root })
    assert.deepEqual(files.map(x => x.label), ['fixture/HANDOFF.md', 'fixture/STATUS.md'])
    const finding = documentSizeFinding(files[0].label, readFileSync(files[0].path, 'utf8'))
    assert.equal(finding?.level, 'check')
    assert.match(finding?.text ?? '', /61 lines and 121 UTF-8 bytes/)
  } finally { removeFixture(root) }
})

test('parsed ledger cache invalidates on change and deletion/recreation', () => {
  const dir = fixture('vn-workflow-ledger-')
  const path = join(dir, 'BACKLOG.md')
  try {
    writeFileSync(path, ledger('OPEN'))
    evictParsedLedger(path)
    const first = parsedLedger(path)
    assert.equal(first.items.find(x => x.id === 'E1')?.state, 'open')
    const original = first.items
    const mtime = new Date('2026-10-20T12:00:00Z')
    writeFileSync(path, ledger('DONE'))
    utimesSync(path, mtime, mtime)
    const second = parsedLedger(path)
    assert.equal(second.items.find(x => x.id === 'E1')?.state, 'done')
    assert.notEqual(second.items, original)
    unlinkSync(path)
    assert.equal(parsedLedger(path).md, null)
    writeFileSync(path, ledger('CLAIMED by fixture, 2026-10-20 12:00'))
    assert.equal(parsedLedger(path).items.find(x => x.id === 'E1')?.state, 'claimed')
    assert.ok(parsedLedgerCacheSize() >= 1)
  } finally {
    evictParsedLedger(path)
    removeFixture(dir)
  }
})

test('worktree ledger changes refresh inside the 15-second inventory cache', () => {
  const root = repoFixture()
  const linked = join(root, 'worker')
  try {
    git(root, 'worktree', 'add', '-b', 'worker', linked)
    const first = worktrees(root, { now: 1000 })
    assert.equal(first.sources.length, 1)
    assert.equal(first.sources[0].items.find(x => x.id === 'E1')?.state, 'open')
    writeFileSync(join(linked, 'docs', 'BACKLOG.md'), ledger('DONE'))
    const second = worktrees(root, { now: 2000 })
    assert.equal(second.at, first.at)
    assert.equal(second.sources[0].items.find(x => x.id === 'E1')?.state, 'done')
  } finally { removeFixture(root) }
})

test('worktree inventory expires and discovers a newly registered checkout', () => {
  const root = repoFixture()
  const linked = join(root, 'worker')
  try {
    const first = worktrees(root, { now: 1000 })
    assert.equal(first.sources.length, 0)
    git(root, 'worktree', 'add', '-b', 'worker', linked)
    const second = worktrees(root, { now: 16_001 })
    assert.equal(second.sources.length, 1)
    assert.equal(second.at, 16_001)
  } finally { removeFixture(root) }
})

test('removed worktree ledger cache entries are evicted when the inventory expires', () => {
  const root = repoFixture()
  const linked = join(root, 'worker')
  const cacheBefore = parsedLedgerCacheSize()
  try {
    git(root, 'worktree', 'add', '-b', 'worker', linked)
    const first = worktrees(root, { now: 1000 })
    assert.equal(first.sources.length, 1)
    assert.ok(parsedLedgerCacheSize() >= cacheBefore + 1)
    git(root, 'worktree', 'remove', linked)
    const second = worktrees(root, { now: 16_001 })
    assert.equal(second.sources.length, 0)
    assert.equal(parsedLedgerCacheSize(), cacheBefore)
  } finally { removeFixture(root) }
})

test('board git status is cached for 15 seconds while fresh reads see edits', () => {
  const root = repoFixture()
  try {
    clearGitStatusCache(root)
    assert.equal(gitStatus(root, { maxAgeMs: 15_000, now: 1000 }).raw, '')
    writeFileSync(join(root, 'README.md'), 'dirty\n')
    assert.equal(gitStatus(root, { maxAgeMs: 15_000, now: 2000 }).raw, '')
    assert.match(gitStatus(root, { maxAgeMs: 15_000, now: 16_000 }).raw, /README\.md/)
    assert.match(gitStatus(root, { maxAgeMs: 15_000, now: 16_001 }).raw, /README\.md/)
    writeFileSync(join(root, 'README.md'), 'clean\n')
    assert.equal(gitStatus(root, { maxAgeMs: 0, now: 16_002 }).raw, '')
  } finally {
    clearGitStatusCache(root)
    removeFixture(root)
  }
})

test('page cache reloads changed content and versions the new shell', () => {
  const dir = fixture('vn-workflow-page-')
  const path = join(dir, 'page.html')
  try {
    writeFileSync(path, '<main>one</main>')
    const first = cachedPage(path)
    assert.equal(first.shell, '<main>one</main>')
    writeFileSync(path, '<main>two</main>')
    const second = cachedPage(path)
    assert.equal(second.shell, '<main>two</main>')
    assert.notEqual(second.version, first.version)
    assert.ok(pageCacheSize() >= 1)
  } finally { removeFixture(dir) }
})

test('board response version changes when cached maintainer status refreshes', () => {
  const root = repoFixture()
  const now = Date.UTC(2026, 9, 20, 12)
  const project = { id: 'workflow-cache-fixture', name: 'Fixture', root, lanes: { E: ['engine', 'engine'], U: ['user', 'user'] }, oracles: [] }
  try {
    clearGitStatusCache(root)
    const first = collect(project, { now })
    assert.equal(first.maintainer.dirty.count, 0)
    writeFileSync(join(root, 'README.md'), 'dirty\n')
    const warm = collect(project, { now: now + 1000 })
    assert.equal(warm.maintainer.dirty.count, 0)
    assert.equal(warm.version, first.version)
    const refreshed = collect(project, { now: now + 15_001 })
    assert.equal(refreshed.maintainer.dirty.count, 1)
    assert.notEqual(refreshed.version, warm.version)
  } finally {
    clearGitStatusCache(root)
    removeFixture(root)
  }
})

test('complete audit recomputes time-based stale-claim findings from cached ledger data', () => {
  const root = repoFixture()
  const project = { id: 'workflow-stale-fixture', root, lanes: { E: ['engine', 'engine'], U: ['user', 'user'] }, oracles: [] }
  const early = Date.parse('2026-10-20T07:00:00')
  const late = Date.parse('2026-10-20T09:00:00')
  try {
    writeFileSync(join(root, 'docs', 'BACKLOG.md'), ledger('CLAIMED by fixture, 2026-10-20 06:00'))
    const first = loadProjectState(project, { fresh: true, now: early })
    const second = loadProjectState(project, { fresh: true, now: late })
    assert.equal(completeAudit(first, { project, messages: [], lessons: [], now: early, includeOracles: false }).findings.some(f => f.code === 'stale-claim'), false)
    assert.equal(completeAudit(second, { project, messages: [], lessons: [], now: late, includeOracles: false }).findings.some(f => f.code === 'stale-claim'), true)
  } finally { removeFixture(root) }
})

test('complete audit assembles ledger, oracle, worktree, document-size, and recovery findings', () => {
  const root = repoFixture()
  const project = { id: 'workflow-complete-audit-fixture', root, lanes: { E: ['engine', 'engine'], U: ['user', 'user'] }, oracles: ['checker.js'] }
  const oracleFile = join(root, 'oracle-lock.json')
  const now = Date.parse('2026-10-20T18:00:00Z')
  try {
    writeFileSync(join(root, 'checker.js'), 'AAAA')
    writeFileSync(join(root, 'HANDOFF.md'), `${'current\n'.repeat(61)}`)
    writeFileSync(oracleFile, JSON.stringify({ projects: { [project.id]: { lockedAt: '2026-10-01T00:00:00.000Z', by: 'user', files: {} } } }))
    const state = loadProjectState(project, { root, fresh: true, now })
    const items = [
      { id: 'E1', title: 'Blocked fixture', lane: 'E', state: 'blocked', plain: 'fixture', gate: 'fixture', needs: [], related: ['E2'], unblock: 'review the related result', blockedAt: '2026-10-19T10:00:00.000Z', notes: [], topics: [], hasStatus: true },
      { id: 'E2', title: 'Done fixture', lane: 'E', state: 'done', plain: 'fixture', gate: 'fixture', needs: [], date: '2026-10-20', time: '10:00', notes: [], hasStatus: true },
      { id: 'E3', title: 'Claimed fixture', lane: 'E', state: 'claimed', owner: 'fixture', plain: 'fixture', gate: 'fixture', needs: [], date: '2026-10-20', time: '06:00', notes: [], hasStatus: true, proof: null },
    ]
    Object.assign(state, { items, effective: items, claims: new Map(), ghosts: [{ id: 'E4', state: 'open', worktree: 'fixture-worktree' }] })
    const { findings } = completeAudit(state, { project, oracleFile, messages: [], lessons: [], now })
    const codes = new Set(findings.map(f => f.code))
    for (const code of ['oracle-new', 'no-proof', 'ghost', 'document-size', 'recovery-review']) assert.ok(codes.has(code), `missing ${code}`)
  } finally { removeFixture(root) }
})

test('oracle verification hashes same-size checker edits on every finding pass', () => {
  const root = fixture('vn-workflow-oracle-')
  const checker = join(root, 'checker.js')
  const lockPath = join(root, 'oracle-lock.json')
  const project = { id: 'workflow-oracle-fixture', root, oracles: ['checker.js'] }
  try {
    writeFileSync(checker, 'AAAA')
    writeFileSync(lockPath, JSON.stringify({ projects: { [project.id]: {
      lockedAt: '2026-10-01T00:00:00.000Z', by: 'user', files: oracleSnapshot(project),
    } } }))
    assert.equal(oracleFindings(project, { file: lockPath }).some(f => f.code === 'oracle-changed'), false)
    const time = new Date('2026-10-05T12:00:00Z')
    writeFileSync(checker, 'BBBB')
    utimesSync(checker, time, time)
    assert.equal(oracleFindings(project, { file: lockPath }).some(f => f.code === 'oracle-changed'), true)
  } finally { removeFixture(root) }
})
