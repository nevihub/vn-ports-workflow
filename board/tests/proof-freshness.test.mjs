import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES = join(HERE, '..', '..', 'templates')
process.env.GIT_AUTHOR_NAME ??= 'proof-test'
process.env.GIT_AUTHOR_EMAIL ??= 'proof-test@example.com'
process.env.GIT_COMMITTER_NAME ??= 'proof-test'
process.env.GIT_COMMITTER_EMAIL ??= 'proof-test@example.com'

// A game checkout with a proof per freshness state: the same engine commit recorded, an older one,
// a proof newer than no source, a proof with no provenance, and an item with no proof at all.
function fixture () {
  const root = mkdtempSync(join(tmpdir(), 'pf-'))
  cpSync(join(TEMPLATES, 'scripts'), join(root, 'scripts'), { recursive: true })
  mkdirSync(join(root, 'docs'), { recursive: true })
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 're', 'verification'), { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const items = {
    'a.fresh': 're/verification/fresh-ok.json',
    'a.stale': 're/verification/stale-ok.json',
    'a.mtime': 're/verification/mtime-ok.json',
    'a.notrace': 're/verification/notrace-ok.json',
    'a.missing': 're/verification/no-such-proof-*.json',
  }
  writeFileSync(join(root, 'docs', 'progress-checklist.json'), JSON.stringify({ description: 'fixture', items:
    Object.entries(items).map(([id, proof]) => ({ id, area: 'engine', title: id, weight: 1, status: 'done', auto: { proof } })) }))
  writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1\n')
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>t</title>\n')
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'c1')
  const c1 = git('rev-parse', '--short', 'HEAD').trim()
  // Proofs recorded at c1; the fresh one is rewritten at c2 below so it stays newest.
  const base = Date.now()
  const proof = (name, head, ok = true) => {
    writeFileSync(join(root, 're', 'verification', name),
      JSON.stringify({ createdAt: new Date().toISOString(), ok, source: head ? { head, dirty: false } : undefined }))
  }
  proof('stale-ok.json', c1)
  proof('notrace-ok.json', null)
  // A source change committed after the proofs: commit-stale, with mtimes rewound so only the
  // commit path (not the mtime path) can call it stale.
  writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 2\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'c2 engine change')
  const c2 = git('rev-parse', '--short', 'HEAD').trim()
  // mtime-stale: current commit, but captured before the latest source touch (rewound below).
  proof('mtime-ok.json', c2)
  const t0 = base - 60000
  for (const f of ['src/app.ts', 'index.html', 're/verification/stale-ok.json',
    're/verification/notrace-ok.json', 're/verification/mtime-ok.json']) {
    utimesSync(join(root, f), new Date(t0), new Date(t0))
  }
  // mtime-stale only: the proof is current, but a source file changed after it was captured.
  // Not "now": Linux stamps new files from a coarse clock that can trail Date.now(), so a proof written next
  // could look older than this touch. Halfway between the rewound proofs and now keeps both orderings.
  utimesSync(join(root, 'src', 'app.ts'), new Date(base - 30000), new Date(base - 30000))
  // Fresh: current commit and newest file in the checkout, so neither path calls it stale.
  proof('fresh-ok.json', c2)
  const rewind = file => utimesSync(join(root, file), new Date(t0), new Date(t0))
  return { root, c1, c2, rewind, git,
    run: args => spawnSync(process.execPath, [join(root, 'scripts', 'check-proofs.mjs'), ...args],
      { encoding: 'utf8', cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }) }
}

test('fresh, stale, missing and untraceable proofs are told apart', () => {
  const { root, run } = fixture()
  const r = run([])
  assert.equal(r.status, 0, r.stderr + r.stdout, 'non-strict only reports')
  const rows = JSON.parse(readFileSync(join(root, 're', 'verification', 'proof-freshness.json'), 'utf8')).rows
  const state = Object.fromEntries(rows.map(row => [row.id, row.state]))
  assert.equal(state['a.fresh'], 'fresh', 'the current proof with no newer source is fresh')
  assert.equal(state['a.stale'], 'stale', 'a proof from before a committed engine change is stale')
  assert.equal(state['a.mtime'], 'stale', 'a current proof older than a touched source is stale')
  assert.equal(state['a.notrace'], 'untraceable', 'a proof with no commit reference is untraceable')
  assert.equal(state['a.missing'], 'missing', 'an unmatched glob is missing, not failed')
})

test('the commit path calls a proof stale even when mtimes are rewound', () => {
  const { root, rewind, run } = fixture()
  // Rewind the touched source: only the recorded commit can still date the proof.
  rewind('src/app.ts')
  rewind('index.html')
  const r = run([])
  assert.equal(r.status, 0, r.stderr)
  const rows = JSON.parse(readFileSync(join(root, 're', 'verification', 'proof-freshness.json'), 'utf8')).rows
  const byId = Object.fromEntries(rows.map(row => [row.id, row]))
  assert.equal(byId['a.stale'].state, 'stale', 'a committed engine change since the proof means stale')
  assert.equal(byId['a.stale'].sourceFilesNewerThanProof, 0, 'no source is newer: only the commit path can say stale')
  assert.ok((byId['a.stale'].commitsSince ?? 0) >= 1, 'the commits-since count names the distance')
  assert.ok((byId['a.stale'].sourceFilesChangedSinceCommit ?? 0) >= 1, 'the changed-files count names the engine change')
  assert.equal(byId['a.fresh'].state, 'fresh', 'the current proof stays fresh once sources are rewound')
})

test('--strict fails only on passing proofs that are not fresh', () => {
  const { run } = fixture()
  const r = run(['--strict'])
  assert.notEqual(r.status, 0, 'a passing stale proof fails --strict')
  assert.match(r.stdout, /stale/, 'the summary names the stale state')
})
