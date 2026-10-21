import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaffold } from '../new-port.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
// Deterministic git identity for the temp repos (child git inherits this env).
process.env.GIT_AUTHOR_NAME ??= 'firewall-test'
process.env.GIT_AUTHOR_EMAIL ??= 'firewall-test@example.com'
process.env.GIT_COMMITTER_NAME ??= 'firewall-test'
process.env.GIT_COMMITTER_EMAIL ??= 'firewall-test@example.com'

function makeScaffold (id) {
  const base = mkdtempSync(join(tmpdir(), 'fw-'))
  const projectsFile = join(base, 'projects.json')
  copyFileSync(join(HERE, '..', 'projects.json'), projectsFile)
  const agentsFile = join(base, 'AGENTS.md')
  writeFileSync(agentsFile, '| Say | Folder |\n| a game not listed | - |\n')
  return scaffold({ base, id, full: `Firewall ${id}`, engine: 'TestEngine', projectsFile, agentsFile })
}

const fw = target => spawnSync(process.execPath, [join(target, 'scripts', 'check-firewall.mjs')], { encoding: 'utf8', cwd: target })
const git = (target, ...args) => execFileSync('git', args, { cwd: target, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

test('a fresh scaffold passes and reports the story-text check as UNAVAILABLE, not as passed', () => {
  const target = makeScaffold('fresh')
  const r = fw(target)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /firewall: PASS/)
  assert.match(r.stdout, /UNAVAILABLE/)
  assert.match(r.stdout, /no extraction corpus yet/)
})

test('forbidden extensions are refused without printing file contents', () => {
  const target = makeScaffold('ext')
  mkdirSync(join(target, 'assets'), { recursive: true })
  const marker = 'marker-bytes-that-must-never-appear-in-output-8f3a'
  writeFileSync(join(target, 'assets', 'evil.ogg'), marker)
  const r = fw(target)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr + r.stdout, /forbidden-extension: assets\/evil\.ogg/)
  assert.ok(!(r.stderr + r.stdout).includes(marker), 'matched contents are never printed')
})

test('game-content folders are refused even when force-staged past the ignore rules', () => {
  const target = makeScaffold('dir')
  mkdirSync(join(target, 'game-data'), { recursive: true })
  writeFileSync(join(target, 'game-data', 'x.txt'), 'planted')
  git(target, 'add', '-f', 'game-data/x.txt')
  const r = fw(target)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr + r.stdout, /forbidden-path: game-data\/x\.txt/)
})

test('a game binary renamed to an innocent extension is caught by its magic bytes', () => {
  const target = makeScaffold('magic')
  const mz = Buffer.concat([Buffer.from([0x4D, 0x5A, 0x90, 0x00]), Buffer.from('not really text, a renamed executable')])
  writeFileSync(join(target, 'notes.txt'), mz)
  git(target, 'add', 'notes.txt')
  const staged = fw(target)
  assert.notEqual(staged.status, 0, 'staged renamed binary must fail')
  assert.match(staged.stderr + staged.stdout, /renamed-windows-binary: notes\.txt/)
  git(target, 'rm', '--cached', '-q', 'notes.txt')
  const untracked = fw(target)
  assert.notEqual(untracked.status, 0, 'untracked renamed binary must fail too')
  assert.match(untracked.stderr + untracked.stdout, /renamed-windows-binary: notes\.txt/)
})

test('an oversized staged blob is refused even when the worktree copy is small', () => {
  const target = makeScaffold('staged-big')
  writeFileSync(join(target, 'big.txt'), Buffer.alloc(3 * 1024 * 1024, 0x41))
  git(target, 'add', 'big.txt')
  writeFileSync(join(target, 'big.txt'), 'small now')
  const r = fw(target)
  assert.notEqual(r.status, 0, 'the staged 3 MiB blob must fail even though the worktree is small')
  assert.match(r.stderr + r.stdout, /oversized-staged: big\.txt/)
})

test('an oversized worktree file is refused even when the staged copy is small', () => {
  const target = makeScaffold('work-big')
  writeFileSync(join(target, 'grows.txt'), 'small at first')
  git(target, 'add', 'grows.txt')
  writeFileSync(join(target, 'grows.txt'), Buffer.alloc(3 * 1024 * 1024, 0x42))
  const r = fw(target)
  assert.notEqual(r.status, 0, 'the 3 MiB worktree file must fail even though the staged copy is small')
  assert.match(r.stderr + r.stdout, /oversized-worktree: grows\.txt/)
})

test('ordinary application code passes, staged or not', () => {
  const target = makeScaffold('clean')
  mkdirSync(join(target, 'src'), { recursive: true })
  writeFileSync(join(target, 'src', 'app.ts'), 'export const x = 1;\n')
  writeFileSync(join(target, 'docs-note.md'), '# notes\nplain project notes\n')
  git(target, 'add', 'src/app.ts', 'docs-note.md')
  const r = fw(target)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /firewall: PASS/)
})

test('when git cannot run, the firewall fails closed instead of passing blindly', () => {
  const target = makeScaffold('nogit')
  const r = spawnSync(process.execPath, [join(target, 'scripts', 'check-firewall.mjs')],
    { encoding: 'utf8', cwd: join(target, 'scripts'), env: { PATH: tmpdir(), SystemRoot: process.env.SystemRoot } })
  assert.notEqual(r.status, 0, 'no git means no staged-content inspection, so no PASS')
  assert.match(r.stderr + r.stdout, /git is unavailable/)
})

test('the repo-clean checker still passes on this workflow repo (no game content, no leftovers)', () => {
  const r = spawnSync(process.execPath, ['scripts/check-repo-clean.mjs'], { encoding: 'utf8', cwd: join(HERE, '..', '..') })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /clean: PASS/)
})

test('a legitimate generated icon stays allowed even though it carries image magic bytes', () => {
  const root = join(HERE, '..', '..')
  const icon = join(root, 'public', 'icons', 'firewall-test-icon.png')
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.from('fake-icon-bytes')])
  mkdirSync(dirname(icon), { recursive: true })
  writeFileSync(icon, png)
  try {
    const r = spawnSync(process.execPath, ['scripts/check-repo-clean.mjs'], { encoding: 'utf8', cwd: root })
    assert.equal(r.status, 0, `icons stay allowed: ${r.stderr}`)
  } finally {
    rmSync(icon, { force: true })
  }
})

test('the template firewall reads staged content and catches a synthetic story-text leak', () => {
  // Minimal game-like fixture: the template scripts plus an ignored corpus and layout.
  const root = mkdtempSync(join(tmpdir(), 'tpl-fw-'))
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'game-data', 'nss'), { recursive: true })
  for (const f of ['scripts/check-firewall.mjs', 'scripts/lib/automation.mjs']) {
    copyFileSync(join(HERE, '..', '..', 'templates', ...f.split('/')), join(root, ...f.split('/')))
  }
  writeFileSync(join(root, '.gitignore'), 'game-data/\nre/\nref/\nprivate/\npublic/game/\ndist/\n')
  writeFileSync(join(root, 'docs', 'progress-checklist.json'), JSON.stringify({ items: [] }))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
  const run = () => spawnSync(process.execPath, [join(root, 'scripts', 'check-firewall.mjs')], { encoding: 'utf8', cwd: root })
  const corpus = 'the quick brown fox jumps over the lazy dog near the quiet river bank'
  writeFileSync(join(root, 'game-data', 'nss', 'a.nss'), `<PRE>${corpus} and then some more story words here</PRE>`)
  writeFileSync(join(root, 'src-clean.md'), '# project notes\nbuild steps and asset budgets\n')
  execFileSync('git', ['add', '-A'], { cwd: root })
  const clean = run()
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  assert.match(clean.stdout, /story text \d+\/\d+ non-binary files vs \d+ shingles/)
  // Leak the corpus wording into a tracked doc, staged: the committed bytes must fail.
  writeFileSync(join(root, 'leak.md'), `# notes\n${corpus} and then some more story words here\n`)
  execFileSync('git', ['add', 'leak.md'], { cwd: root })
  const bad = run()
  assert.notEqual(bad.status, 0, 'staged story-text leak must fail')
  assert.match(bad.stderr + bad.stdout, /story-text: leak\.md/)
  assert.ok(!(bad.stderr + bad.stdout).includes(corpus), 'matched story text is never printed')
  assert.ok(existsSync(join(root, 're', 'verification', 'firewall.json')), 'a proof record is written')
  const proof = JSON.parse(readFileSync(join(root, 're', 'verification', 'firewall.json'), 'utf8'))
  assert.equal(proof.ok, false)
  assert.equal(proof.fingerprint.available, true)
})
