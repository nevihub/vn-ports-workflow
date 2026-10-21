import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audit } from '../lib/audit.mjs'
import { unmetNeeds } from '../lib/backlog.mjs'
import { parse } from '../lib/ledger.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ISSUE = join(HERE, '..', 'issue.mjs')

const LEDGER = [
  '# Backlog', '',
  '## Timeline', '',
  '### [S1] Work', 'Tickets: E1, E2, E3, E4, E5', 'Weight: 100', '',
  '## Lanes', '',
  '### Lane E', '',
  '### [E1] Base', 'Status: OPEN', 'Plain: base work', 'Gate: base done', 'Proof: npm run ok', '',
  '### [E2] Second', 'Status: OPEN', 'Plain: second work', 'Gate: second done', 'Proof: npm run ok', 'Needs: E1', '',
  '### [E3] No proof', 'Status: OPEN', 'Plain: third work', 'Gate: third done', '',
  '### [E4] No gate', 'Status: OPEN', 'Plain: fourth work', 'Proof: npm run ok', '',
  '### [E5] Failing proof', 'Status: OPEN', 'Plain: fifth work', 'Gate: fifth done', 'Proof: npm run bad', '',
  '### Lane U', '',
  '### [U1] User question', 'Status: OPEN', 'Plain: the user answers this', '',
].join('\n')

function setup () {
  const root = mkdtempSync(join(tmpdir(), 'gates-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), LEDGER)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'g', private: true, scripts: { ok: 'node -e "process.exit(0)"', bad: 'node -e "process.exit(3)"' } }))
  const run = (...a) => spawnSync(process.execPath, [ISSUE, '--root', root, ...a], { encoding: 'utf8', cwd: root })
  const state = id => parse(readFileSync(join(root, 'docs', 'BACKLOG.md'), 'utf8')).find(i => i.id === id)
  return { root, run, state }
}

test('unmet dependencies reject claims and closure', () => {
  const { run, state } = setup()
  assert.deepEqual(unmetNeeds(state('E2'), parse(LEDGER)), ['E1'])
  const c = run('claim', 'E2', '--by', 'codex wt')
  assert.notEqual(c.status, 0, 'claim with unmet Needs must fail')
  assert.match(c.stderr, /needs E1/)
  assert.equal(state('E2').state, 'open')
  const d = run('done', 'E2', '--commit', 'abcdef1')
  assert.notEqual(d.status, 0, 'done with unmet Needs must fail')
  assert.match(d.stderr, /needs E1/)
  assert.equal(state('E2').state, 'open')
})

test('missing proof and missing gate reject closure; a passing proof permits it', () => {
  const { run, state } = setup()
  const noProof = run('done', 'E3', '--commit', 'abcdef1')
  assert.notEqual(noProof.status, 0, 'done without a Proof must fail')
  assert.match(noProof.stderr, /no Proof/)
  assert.equal(state('E3').state, 'open')
  const noGate = run('done', 'E4', '--commit', 'abcdef1')
  assert.notEqual(noGate.status, 0, 'done without a Gate must fail')
  assert.match(noGate.stderr, /no Gate/)
  assert.equal(state('E4').state, 'open')
  assert.equal(run('gate', 'E4', 'fourth done').status, 0)
  assert.equal(run('done', 'E4', '--commit', 'abcdef1').status, 0)
  assert.equal(state('E4').state, 'done')
  assert.match(state('E4').note, /proof passed \(npm run ok\)/)
})

test('a failing proof rejects closure; fixing the work (not the gate) then permits it', () => {
  const { run, state } = setup()
  const bad = run('done', 'E5', '--commit', 'abcdef1')
  assert.notEqual(bad.status, 0, 'failing proof must keep the ticket open')
  assert.match(bad.stderr, /stays open/)
  assert.equal(state('E5').state, 'open')
  assert.equal(run('proof', 'E5', 'npm run ok').status, 0)
  assert.equal(run('done', 'E5', '--commit', 'abcdef1').status, 0)
  assert.equal(state('E5').state, 'done')
})

test('finishing the prerequisite unblocks claim and closure', () => {
  const { run, state } = setup()
  assert.equal(run('done', 'E1', '--commit', 'abcdef1').status, 0)
  assert.equal(run('claim', 'E2', '--by', 'codex wt').status, 0)
  assert.equal(state('E2').state, 'claimed')
  assert.equal(run('done', 'E2', '--commit', 'abcdef1').status, 0)
  assert.equal(state('E2').state, 'done')
})

test('agents cannot close user-owned tickets; a recorded user answer can', () => {
  const { run, state } = setup()
  const silent = run('done', 'U1', '--commit', 'abcdef1')
  assert.notEqual(silent.status, 0, 'silent agent closure of a U ticket must fail')
  assert.match(silent.stderr, /user's/)
  assert.equal(state('U1').state, 'open')
  assert.equal(run('done', 'U1', '--commit', 'abcdef1', '--user-ok', 'edition X installed at D:/games/x').status, 0)
  const u1 = state('U1')
  assert.equal(u1.state, 'done')
  assert.match(u1.waiver ?? '', /user-ok edition X/)
})

test('a human proof waiver closes the ticket but stays visibly distinguishable', () => {
  const { root, run, state } = setup()
  assert.equal(run('done', 'E3', '--commit', 'abcdef1', '--waive-proof', 'harness broken, see HANDOFF').status, 0)
  const e3 = state('E3')
  assert.equal(e3.state, 'done')
  assert.match(e3.waiver ?? '', /proof harness broken/)
  assert.match(e3.note ?? '', /proof skipped: harness broken/)
  // The legacy alias records the same waiver.
  assert.equal(run('done', 'E4', '--commit', 'abcdef1', '--skip-proof', 'gate added by hand').status, 0)
  assert.match(state('E4').waiver ?? '', /proof gate added by hand/)
  const md = readFileSync(join(root, 'docs', 'BACKLOG.md'), 'utf8')
  const codes = audit(parse(md), { md }).filter(f => f.id === 'E3' || f.id === 'E4').map(f => f.code)
  assert.ok(codes.includes('waived-proof'), `waivers must stay flagged, got ${codes}`)
})

test('historical DONE tickets without proof are flagged, never rewritten', () => {
  const { root, state } = setup()
  const md0 = readFileSync(join(root, 'docs', 'BACKLOG.md'), 'utf8')
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), md0 + '\n### [E6] Legacy\nStatus: DONE 2026-09-01, abc1234 - landed long ago\nPlain: old work\nGate: old gate\n')
  const e6 = state('E6')
  assert.equal(e6.state, 'done', 'history is preserved as-is')
  const findings = audit(parse(readFileSync(join(root, 'docs', 'BACKLOG.md'), 'utf8')), { md: md0 })
  const legacy = findings.filter(f => f.id === 'E6')
  assert.ok(legacy.some(f => f.code === 'unverified-done'), 'legacy unverified closure must be flagged')
  assert.ok(!legacy.some(f => f.code === 'waived-proof'), 'legacy closure is not a waiver')
})

test('a claimed ticket whose Needs are unmet is flagged by the audit', () => {
  const md = '### [E1] Base\nStatus: OPEN\n### [E2] Second\nStatus: CLAIMED by codex wt, 2026-10-21 10:00\nNeeds: E1\n'
  const codes = audit(parse(md), { md }).filter(f => f.id === 'E2').map(f => f.code)
  assert.ok(codes.includes('needs-unmet'), `expected needs-unmet, got ${codes}`)
})
