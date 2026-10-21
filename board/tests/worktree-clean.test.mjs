import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { inspectRepository, isAppManagedPath, runWorktreeCleanup } from '../lib/worktree-clean.mjs'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const fixtureRoot = () => mkdtempSync(join(tmpdir(), 'vn-worktree-clean-'))
const removeFixture = path => {
  const base = resolve(tmpdir()) + sep
  const target = resolve(path)
  if (!target.startsWith(base)) throw new Error('refusing to remove a test path outside the temporary directory')
  rmSync(target, { recursive: true, force: true })
}
const ledger = state => [
  '# Backlog', '', '## Timeline', '', '### [S1] Stage', 'Tickets: E1', 'Weight: 100', 'Playable: yes',
  '', '## Lanes', '', '### Lane E', '', '### [E1] Ticket', 'Plain: test', 'Gate: test', 'Status: ' + state, '',
].join('\n')

function fixture (pathBuilder = root => join(root, 'candidate'), { detached = false } = {}) {
  const root = fixtureRoot()
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), ledger('DONE 2026-10-20'))
  writeFileSync(join(root, 'HANDOFF.md'), 'current\n')
  writeFileSync(join(root, 'README.md'), 'clean\n')
  writeFileSync(join(root, '.gitignore'), '*.ignored\n')
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.email', 'fixture@example.invalid')
  git(root, 'config', 'user.name', 'Fixture')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'fixture baseline')
  const candidatePath = pathBuilder(root)
  if (detached) git(root, 'worktree', 'add', '--detach', candidatePath, 'HEAD')
  else git(root, 'worktree', 'add', '-b', 'candidate', candidatePath, 'HEAD')
  const now = new Date().toISOString()
  const candidate = { path: candidatePath, tickets: ['E1'], ownerState: 'verified-inactive', ownerCheckedAt: now,
    activeJobs: [], activeJobsCheckedAt: now, appManaged: false, pinned: false, checkoutClassificationCheckedAt: now }
  const projects = [{ id: 'fixture', root }]
  const repository = { id: 'fixture-repo', root: 'project:fixture', integrationBranch: 'main', ledgerProject: 'fixture', candidates: [candidate], prune: [] }
  const manifest = { repositories: [repository] }
  return { root, candidatePath, candidate, repository, manifest, projects, boardRoot: root }
}

const check = fx => inspectRepository(fx.repository, fx.projects, fx.boardRoot)
const reasons = fx => check(fx).candidates[0]?.reasons ?? []

test('inventory is read-only and reports refusal for unassociated worktrees', () => {
  const fx = fixture()
  try {
    fx.repository.candidates = []
    const before = git(fx.root, 'worktree', 'list', '--porcelain')
    const result = runWorktreeCleanup({ ...fx, apply: false })
    const after = git(fx.root, 'worktree', 'list', '--porcelain')
    assert.equal(result.removed.length, 0)
    assert.match(result.output.join('\n'), /no explicit candidate-to-ticket association/)
    assert.equal(after, before)
    assert.ok(existsSync(fx.candidatePath))
  } finally { removeFixture(fx.root) }
})

test('dry run accepts a clean merged candidate but never removes it', () => {
  const fx = fixture()
  try {
    const result = runWorktreeCleanup({ ...fx, apply: false })
    assert.equal(result.exitCode, 0)
    assert.ok(result.output.some(line => line.startsWith('ELIGIBLE ')))
    assert.equal(result.removed.length, 0)
    assert.ok(existsSync(fx.candidatePath))
  } finally { removeFixture(fx.root) }
})

test('apply removes a merged, clean worktree through non-forced Git removal', () => {
  const fx = fixture()
  const calls = []
  try {
    const result = runWorktreeCleanup({ ...fx, apply: true, executeGit: (cwd, args) => {
      calls.push([...args])
      return git(cwd, ...args)
    } })
    assert.deepEqual(result.removed.map(path => resolve(path)), [resolve(fx.candidatePath)])
    assert.ok(calls.some(args => args[0] === 'worktree' && args[1] === 'remove' && !args.includes('--force')))
    assert.equal(existsSync(fx.candidatePath), false)
  } finally { removeFixture(fx.root) }
})

test('documentation commits are eligible once merged into the integration branch', () => {
  const fx = fixture()
  try {
    writeFileSync(join(fx.candidatePath, 'HANDOFF.md'), 'updated\n')
    git(fx.candidatePath, 'add', 'HANDOFF.md')
    git(fx.candidatePath, 'commit', '-m', 'documentation update')
    git(fx.root, 'merge', '--no-ff', 'candidate', '-m', 'integrate documentation')
    assert.deepEqual(reasons(fx), [])
  } finally { removeFixture(fx.root) }
})

test('detached HEADs use the same ancestor and cleanliness checks', () => {
  const fx = fixture(root => join(root, 'detached'), { detached: true })
  try {
    assert.deepEqual(reasons(fx), [])
  } finally { removeFixture(fx.root) }
})

test('candidate is refused unless every fresh ownership attestation is explicit', () => {
  const fx = fixture()
  try {
    delete fx.candidate.activeJobs
    assert.ok(reasons(fx).some(reason => /no-active-job attestation/.test(reason)))
    fx.candidate.activeJobs = []
    fx.candidate.activeJobsCheckedAt = '2000-01-01T00:00:00.000Z'
    assert.ok(reasons(fx).some(reason => /no-active-job attestation/.test(reason)))
    fx.candidate.activeJobsCheckedAt = new Date().toISOString()
    fx.candidate.pinned = true
    assert.ok(reasons(fx).some(reason => /pinned status/.test(reason)))
  } finally { removeFixture(fx.root) }
})

test('unmerged candidate HEAD is refused', () => {
  const fx = fixture()
  try {
    writeFileSync(join(fx.candidatePath, 'README.md'), 'unmerged\n')
    git(fx.candidatePath, 'add', 'README.md')
    git(fx.candidatePath, 'commit', '-m', 'unmerged work')
    assert.ok(reasons(fx).some(reason => /not an ancestor/.test(reason)))
  } finally { removeFixture(fx.root) }
})

test('tickets must be DONE and no mapped checkout may hold a claim or recovery', () => {
  const unfinished = fixture()
  try {
    writeFileSync(join(unfinished.root, 'docs', 'BACKLOG.md'), ledger('OPEN'))
    assert.ok(reasons(unfinished).some(reason => /E1 is OPEN in the integration ledger/.test(reason)))
  } finally { removeFixture(unfinished.root) }

  for (const status of ['CLAIMED by fixture, 2026-10-20 12:00', 'BLOCKED: waiting']) {
    const fx = fixture()
    const other = join(fx.root, 'other')
    try {
      git(fx.root, 'worktree', 'add', '-b', 'other', other, 'HEAD')
      writeFileSync(join(other, 'docs', 'BACKLOG.md'), ledger(status))
      const why = reasons(fx).join('; ')
      assert.match(why, status.startsWith('CLAIMED') ? /active claim/ : /active recovery work/)
    } finally { removeFixture(fx.root) }
  }
})

test('tracked, untracked, ignored, embedded, locked, and primary checkouts are refused', () => {
  const cases = [
    ['tracked', fx => writeFileSync(join(fx.candidatePath, 'README.md'), 'changed\n'), /tracked changes/],
    ['untracked', fx => writeFileSync(join(fx.candidatePath, 'extra.txt'), 'extra\n'), /untracked files/],
    ['ignored', fx => writeFileSync(join(fx.candidatePath, 'extra.ignored'), 'ignored\n'), /ignored files/],
    ['embedded', fx => { mkdirSync(join(fx.candidatePath, 'embedded')); writeFileSync(join(fx.candidatePath, 'embedded', '.git'), 'gitdir: invalid\n') }, /embedded repository or nested worktree/],
    ['submodule declaration', fx => writeFileSync(join(fx.candidatePath, '.gitmodules'), '[submodule "x"]\n'), /submodules or embedded repository/],
    ['locked', fx => git(fx.root, 'worktree', 'lock', fx.candidatePath), /worktree is locked/],
  ]
  for (const [name, mutate, pattern] of cases) {
    const fx = fixture()
    try {
      mutate(fx)
      assert.match(reasons(fx).join('; '), pattern, name)
    } finally { removeFixture(fx.root) }
  }
  const primary = fixture()
  try {
    primary.candidate.path = primary.root
    assert.match(reasons(primary).join('; '), /primary checkout cannot be removed/)
  }
  finally { removeFixture(primary.root) }
})

test('unknown paths and Git failures are refused without a filesystem fallback', () => {
  const missing = fixture()
  try {
    missing.candidate.path = 'relative/path'
    assert.ok(reasons(missing).some(reason => /path is not absolute/.test(reason)))
  } finally { removeFixture(missing.root) }

  const failed = fixture()
  try {
    const result = runWorktreeCleanup({ ...failed, apply: true, executeGit: (cwd, args) => {
      if (args[0] === 'worktree' && args[1] === 'remove') {
        const error = new Error('refused')
        error.code = 'EPERM'
        throw error
      }
      return git(cwd, ...args)
    } })
    assert.equal(result.removed.length, 0)
    assert.ok(result.output.some(line => /non-forced Git worktree removal failed/.test(line)))
    assert.ok(existsSync(failed.candidatePath))
  } finally { removeFixture(failed.root) }
})

test('Git failures during fresh eligibility checks block removal', () => {
  const fx = fixture()
  try {
    const result = runWorktreeCleanup({ ...fx, apply: true, executeGit: () => {
      const error = new Error('ownership refused')
      error.code = 'EPERM'
      throw error
    } })
    assert.equal(result.removed.length, 0)
    assert.ok(result.output.some(line => /final Git eligibility recheck failed/.test(line)))
    assert.ok(existsSync(fx.candidatePath))
  } finally { removeFixture(fx.root) }
})

test('last-moment checkout changes fail the recheck and preserve the worktree', () => {
  const fx = fixture()
  try {
    const result = runWorktreeCleanup({ ...fx, apply: true, afterInspect: ({ path }) => writeFileSync(join(path, 'late.txt'), 'late\n') })
    assert.equal(result.removed.length, 0)
    assert.ok(result.output.some(line => /eligibility changed before removal/.test(line)))
    assert.ok(existsSync(join(fx.candidatePath, 'late.txt')))
  } finally { removeFixture(fx.root) }
})

test('pruning requires apply and dry runs do not mutate metadata', () => {
  const fx = fixture()
  try {
    const rejected = runWorktreeCleanup({ ...fx, apply: false, prune: true })
    assert.equal(rejected.exitCode, 2)
    assert.match(rejected.errors[0], /--prune requires --apply/)
    const before = git(fx.root, 'worktree', 'list', '--porcelain')
    const dry = runWorktreeCleanup({ ...fx, apply: false, prune: false })
    const after = git(fx.root, 'worktree', 'list', '--porcelain')
    assert.equal(dry.removed.length, 0)
    assert.equal(after, before)
  } finally { removeFixture(fx.root) }
})

test('app-managed worktree paths are classified for lifecycle-tool refusal', () => {
  assert.equal(isAppManagedPath(join(homedir(), '.codex', 'worktrees', 'fixture')), true)
  assert.equal(isAppManagedPath(join(tmpdir(), 'fixture')), false)
})
