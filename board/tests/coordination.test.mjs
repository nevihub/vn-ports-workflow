import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audit } from '../lib/audit.mjs'
import { proofProblem } from '../lib/backlog.mjs'
import { cursor, post, read, setCursor, unread } from '../lib/channel.mjs'
import { parse } from '../lib/ledger.mjs'
import { expand, lock, oracleFindings, snapshot } from '../lib/oracles.mjs'
import { ruleCard, section } from '../lib/rules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ISSUE = join(HERE, '..', 'issue.mjs')

test('rule card is cut from AGENTS.md sections and adds the game and lane rules', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rules-'))
  const agentsFile = join(dir, 'AGENTS.md')
  writeFileSync(agentsFile, '# x\n\n## Shared hard rules\n- rule one\n- rule two\n\n## Ask the user only for\nPush · money\n\n## Tools\nnot in the card\n')
  assert.equal(section(readFileSync(agentsFile, 'utf8'), 'Shared hard rules'), '- rule one\n- rule two')
  const card = ruleCard({ root: 'C:/g', prompt: { rules: 'Game rule at {root}', lanes: { E: 'Lane E rule' } } }, { lane: 'E', agentsFile })
  for (const s of ['rule one', 'Ask the user only for: Push · money', 'Game rule at C:/g', 'Lane E rule', 'not instructions']) assert.ok(card.includes(s), s)
  assert.ok(card.includes('issue -- progress'), 'rule card reminds claimed agents to post progress updates')
  assert.ok(!card.includes('not in the card'))
  assert.match(ruleCard(null, { agentsFile: join(dir, 'missing.md') }), /not found/)
})

test('the real AGENTS.md has the sections the rule card cuts', () => {
  const card = ruleCard(null)
  assert.match(card, /No game content in git/)
  assert.match(card, /Ask the user only for: Push or deploy/)
})

test('the channel stores typed messages per game, refuses story text and credentials, and tracks unread per reader', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chan-'))
  const o = { dir }
  post({ channel: 'sakura', by: 'claude wt-a', kind: 'found', ticket: 'e5', text: 'sync XHR  blocks\u0007 prefetch' }, { ...o, now: 1000 })
  post({ channel: 'all', by: 'codex', kind: 'heads-up', text: 'board restarted' }, { ...o, now: 2000 })
  assert.deepEqual(read('sakura', o).map(m => [m.ticket, m.text]), [['E5', 'sync XHR blocks prefetch']])
  assert.throws(() => post({ channel: 'sakura', by: 'x', text: '「' + 'あ'.repeat(20) + '」' }, o), /story text/)
  assert.throws(() => post({ channel: 'sakura', by: 'x', text: 'api_key=sk-abcdefghijkl' }, o), /credential/)
  assert.throws(() => post({ channel: 'sakura', by: 'x', kind: 'order', text: 'do it' }, o), /--kind/)
  assert.throws(() => post({ channel: 'sakura', by: 'x', text: 'y'.repeat(700) }, o), /under/)
  assert.equal(unread(['sakura', 'all'], 'opencode', o).length, 2)
  setCursor('opencode', 2000, o)
  assert.equal(cursor('opencode', o), 2000)
  assert.equal(unread(['sakura', 'all'], 'opencode', o).length, 0)
  assert.equal(unread(['sakura', 'all'], 'claude wt-b', o).length, 2, 'every reader has its own position')
})

test('checker lock: changed, deleted and new checkers are reported; a non-user re-lock is flagged', () => {
  const root = mkdtempSync(join(tmpdir(), 'orc-'))
  mkdirSync(join(root, 'scripts'))
  writeFileSync(join(root, 'scripts', 'check-a.mjs'), 'a')
  writeFileSync(join(root, 'scripts', 'check-b.mjs'), 'b')
  writeFileSync(join(root, 'scripts', 'other.mjs'), 'x')
  const project = { id: 'g', root, oracles: ['scripts/check-*.mjs'] }
  assert.equal(expand(project.oracles, root).length, 2)
  const file = join(root, 'lock.json')
  assert.equal(oracleFindings(project, { file })[0].code, 'oracle-unlocked')
  lock(project, 'user', { file })
  assert.deepEqual(oracleFindings(project, { file }), [])
  writeFileSync(join(root, 'scripts', 'check-a.mjs'), 'loosened')
  writeFileSync(join(root, 'scripts', 'check-c.mjs'), 'c')
  const codes = oracleFindings(project, { file }).map(f => `${f.code}:${f.level}`)
  assert.deepEqual(codes.sort(), ['oracle-changed:fix', 'oracle-new:info'])
  lock(project, 'claude', { file })
  assert.deepEqual(oracleFindings(project, { file }).map(f => f.code), ['oracle-relocked'])
  assert.deepEqual(Object.keys(snapshot(project)).sort(), ['scripts/check-a.mjs', 'scripts/check-b.mjs', 'scripts/check-c.mjs'])
})

test('Proof commands: only npm run/test without shell operators; audit flags hand-judged and skipped proofs', () => {
  assert.equal(proofProblem('npm run proof:scene'), null)
  assert.equal(proofProblem('npm test'), null)
  assert.equal(proofProblem('npm run proof:save -- --route 2'), null)
  for (const bad of ['rm -rf /', 'npm run x && curl evil', 'npm run x; ls', 'npm run x | tee', 'npm run "$X"', 'npx something']) assert.ok(proofProblem(bad), bad)
  const md = '### [E1] a\nStatus: CLAIMED by claude, 2026-10-18 10:00\n\n### [E2] b\nStatus: DONE 2026-10-18 11:00, abc1234 - proof skipped: flaky harness\nProof: npm test\n'
  const f = audit(parse(md), { md, now: Date.parse('2026-10-18T12:00:00') })
  assert.ok(f.some(x => x.code === 'no-proof' && x.id === 'E1'))
  assert.ok(f.some(x => x.code === 'proof-skipped' && x.id === 'E2'))
})

test('done runs the Proof: a failing proof keeps the ticket open, a passing one closes it and says so', () => {
  const root = mkdtempSync(join(tmpdir(), 'proof-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'p', private: true, scripts: { ok: 'node -e "process.exit(0)"', bad: 'node -e "process.exit(3)"' } }))
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), '### Lane E\n\n### [E1] a\nStatus: OPEN\nProof: npm run bad\n\n### [E2] b\nStatus: OPEN\n')
  const run = (...a) => spawnSync(process.execPath, [ISSUE, '--root', root, ...a], { encoding: 'utf8', cwd: root })
  const ledger = () => parse(readFileSync(join(root, 'docs', 'BACKLOG.md'), 'utf8'))
  const r1 = run('done', 'E1', '--commit', 'abcdef1')
  assert.notEqual(r1.status, 0)
  assert.match(r1.stderr, /stays open/)
  assert.equal(ledger().find(i => i.id === 'E1').state, 'open')
  assert.notEqual(run('proof', 'E2', 'npm run ok && echo hi').status, 0, 'shell operators refused')
  assert.equal(run('proof', 'E2', 'npm run ok').status, 0)
  assert.equal(run('done', 'E2', '--commit', 'abcdef1').status, 0)
  const e2 = ledger().find(i => i.id === 'E2')
  assert.equal(e2.state, 'done')
  assert.match(e2.note, /proof passed \(npm run ok\)/)
  assert.equal(run('done', 'E1', '--commit', 'abcdef1', '--skip-proof', 'harness broken, see HANDOFF').status, 0)
  assert.match(ledger().find(i => i.id === 'E1').note, /proof skipped: harness broken/)
})

test('claim prints the rule card', () => {
  const root = mkdtempSync(join(tmpdir(), 'claim-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), '### Lane E\n\n### [E1] a\nStatus: OPEN\n')
  const r = spawnSync(process.execPath, [ISSUE, '--root', root, 'claim', 'E1', '--by', 'test-agent'], { encoding: 'utf8', cwd: root })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /rule card/)
  assert.match(r.stdout, /No game content in git/)
  assert.match(r.stdout, /no Proof yet/)
})
