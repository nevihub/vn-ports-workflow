import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentBlock, agentKey, appendNote, insertItem, parse, rankNext, setFields, setNeeds, setProgress, setRating, setStatus, suggestCombos, suggestOrder } from '../lib/backlog.mjs'
import { audit } from '../lib/audit.mjs'
import { appendLesson, kbFiles, kbSearch, rankKbFiles, recentLessons, storyLike } from '../lib/knowledge.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ISSUE = join(HERE, '..', 'issue.mjs')

test('suggestCombos: one per lane, sized for the agent budget, same-folder extras flagged for a worktree', () => {
  const it = (id, lane) => ({ id, lane })
  const ready = [it('E5', 'E'), it('E7', 'E'), it('E8', 'E'), it('M3', 'M'), it('M4', 'M'), it('R2', 'R'), it('E9', 'E')]
  const { combos, moreByLane } = suggestCombos(ready)
  assert.deepEqual(combos.map(c => [c.size, c.ids]), [[2, ['E5', 'M3']], [3, ['E5', 'M3', 'R2']], [4, ['E5', 'M3', 'R2', 'E7']]])
  assert.deepEqual(combos.map(c => c.needsWorktree), [[], [], ['E7']])
  assert.deepEqual(moreByLane, [{ lane: 'E', ids: ['E7', 'E8', 'E9'] }, { lane: 'M', ids: ['M4'] }])
  // one lane only: the second seat sits in the same folder, flagged; sizes that add nothing are dropped
  assert.deepEqual(suggestCombos([it('E5', 'E'), it('E7', 'E')]).combos,
    [{ size: 2, ids: ['E5', 'E7'], needsWorktree: ['E7'] }])
  // fewer than two ready tickets -> no combo
  assert.deepEqual(suggestCombos([it('E5', 'E')]).combos, [])
  assert.deepEqual(suggestCombos([]).combos, [])
})

const COMBO_LEDGER = [
  '# Backlog',
  '',
  '## Timeline',
  '',
  '### [S1] Now',
  'Tickets: E5, E7, E8, E9, M3, M4, R2',
  'Weight: 100',
  '',
  '## Lanes',
  '',
  '### Lane E — engine',
  '',
  '### [E5] a',
  'Status: OPEN',
  'Prio: P1',
  '',
  '### [E7] b',
  'Status: OPEN',
  'Prio: P2',
  '',
  '### [E8] c',
  'Status: OPEN',
  'Prio: P2',
  '',
  '### [E9] d',
  'Status: OPEN',
  'Prio: P3',
  '',
  '### Lane M — media',
  '',
  '### [M3] e',
  'Status: OPEN',
  'Prio: P2',
  '',
  '### [M4] f',
  'Status: OPEN',
  'Prio: P2',
  '',
  '### Lane R — reader',
  '',
  '### [R2] g',
  'Status: OPEN',
  'Prio: P2',
  '',
].join('\n')

test('goal prints run-together combos: one per folder, sized 2-4, same-folder extras starred', () => {
  const root = mkdtempSync(join(tmpdir(), 'combos-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), COMBO_LEDGER)
  const out = execFileSync(process.execPath, [ISSUE, '--root', root, 'goal'], { encoding: 'utf8', cwd: root })
  // no projects.json entry here, so ties sort by ticket number (real games configure a lane order)
  assert.match(out, /Ready to start: E5, R2, M3, M4, E7, E8, E9/)
  assert.match(out, /Run together \(one writer per folder; \* = give it its own worktree \+ branch\):/)
  assert.match(out, /2 agents: E5 \+ R2/)
  assert.match(out, /3 agents: E5 \+ R2 \+ M3/)
  assert.match(out, /4 agents: E5 \+ R2 \+ M3 \+ M4\*/)
  assert.match(out, /Also ready, same folder as a pick above \(one each, own checkout\): M4 \(M\) · E7 E8 E9 \(E\)/)
  assert.match(out, /Best order to run/)
  assert.match(out, /1\. start E5/)
})

test('suggestOrder: finish claimed first (closest first), then ready, then what they unblock', () => {
  const md = [
    '# Backlog', '',
    '## Timeline', '',
    '### [S1] Now', 'Tickets: E1, E2, E3, E4', 'Weight: 100', '',
    '## Lanes', '',
    '### Lane E — engine', '',
    '### [E1] one', 'Status: CLAIMED by claude wt, 2026-10-17 10:00', 'Progress: 80% - driving it home', 'Prio: P1', '',
    '### [E2] two', 'Status: OPEN', 'Prio: P2', '',
    '### [E3] three', 'Status: OPEN', 'Prio: P1', 'Needs: E1', '',
    '### [E4] four', 'Status: OPEN', 'Prio: P1', 'Needs: E3', '',
  ].join('\n')
  const order = suggestOrder(parse(md), { laneOrder: ['E'] })
  assert.deepEqual(order.map(s => `${s.action} ${s.id}`), ['finish E1', 'start E2', 'queue E3', 'queue E4'])
  assert.match(order[0].why, /opens E3/)
  assert.match(order[2].why, /after E1/)
})

const LEDGER = [
  '# Backlog',
  '',
  '## Timeline',
  '',
  '### [S0] Research',
  'Status: DONE 2026-10-01',
  'Weight: 10',
  '',
  '### [S1] Boots',
  'Tickets: E1, E2, E3',
  'Weight: 40',
  '',
  '### [S2] Playable',
  'Tickets: E4, W1',
  'Weight: 50',
  'Playable: yes',
  '',
  '## Lanes',
  '',
  '### Lane E — engine',
  '',
  '### [E1] Loader',
  'Plain: load files',
  'Status: DONE 2026-10-17 10:00, abc1234 - landed',
  'Gate: boots',
  '',
  '### [E2] Second lever',
  'Plain: more',
  'Status: OPEN',
  'Prio: P3',
  'Needs: E1',
  'Gate: g',
  'Proof: npm run ok',
  '',
  '### [E3] Third',
  'Plain: x',
  'Status: OPEN',
  'Prio: P1',
  'Needs: E2',
  'Gate: g',
  '',
  '### [E4] Later stage but P1',
  'Plain: x',
  'Status: OPEN',
  'Prio: P1',
  'Gate: g',
  '',
  '### Lane W — web',
  '',
  '### [W1] Page',
  'Plain: x',
  'Status: BLOCKED: waits for E1',
  'Type: verify',
  'Gate: g',
  '',
  '### Lane U — you',
  '',
  '### [U1] Phone test',
  'Plain: x',
  'Status: OPEN',
  '',
].join('\n')

test('parse reads Needs, Agents and line positions; CRLF ledgers parse the same', () => {
  const items = parse(LEDGER)
  const e3 = items.find(i => i.id === 'E3')
  assert.deepEqual(e3.needs, ['E2'])
  assert.equal(LEDGER.split('\n')[e3.statusLine], 'Status: OPEN')
  const crlf = parse(LEDGER.replace(/\n/g, '\r\n'))
  assert.deepEqual(crlf.map(i => [i.id, i.state, i.needs.join()]), items.map(i => [i.id, i.state, i.needs.join()]))
  const withAgents = parse('### [E9] x\nStatus: OPEN\nAgents: Claude, codex\n')
  assert.deepEqual(withAgents[0].agents, ['claude', 'codex'])
})

test('rankNext: current stage first, then Prio; Needs, claims, blocks, U and other worktrees are skipped', () => {
  const items = parse(LEDGER)
  const r = rankNext(items, { laneOrder: ['E', 'W', 'U'] })
  // E2 (S1, P3, needs E1 done) beats E4 (S2, P1); E3 waits on E2.
  assert.deepEqual(r.ready.map(i => i.id), ['E2', 'E4'])
  const why = Object.fromEntries(r.skipped.map(s => [s.item.id, s.why]))
  assert.match(why.E3, /needs E2/)
  assert.match(why.W1, /blocked/)
  assert.match(why.U1, /user/)
  const elsewhere = new Map([['E2', { state: 'claimed', worktree: 'wt-e2' }]])
  assert.deepEqual(rankNext(items, { elsewhere }).ready.map(i => i.id), ['E4'])
  assert.deepEqual(rankNext(items, { lane: 'w' }).ready.map(i => i.id), [])
})

test('agent rules: projects.json allowlists and a ticket Agents line', () => {
  assert.equal(agentKey('OpenCode round7'), 'opencode')
  assert.equal(agentKey('Codex (gpt-6.1-sol) wt'), 'codex')
  const items = parse(LEDGER)
  const rules = { opencode: { types: ['verify'] } }
  const r = rankNext(items, { agent: 'opencode', rules })
  assert.deepEqual(r.ready.map(i => i.id), [])
  assert.match(r.skipped.find(s => s.item.id === 'E2').why, /only takes Type verify/)
  assert.deepEqual(rankNext(items, { agent: 'claude', rules }).ready.map(i => i.id), ['E2', 'E4'])
  const only = parse('### [E9] x\nStatus: OPEN\nAgents: codex\n')[0]
  assert.match(agentBlock(only, 'claude', {}), /only for codex/)
  assert.equal(agentBlock(only, 'codex', {}), null)
})

test('audit: unblocked, prose deps, ripples, stale claims, timeline shape, hygiene - and it never writes', () => {
  let md = LEDGER.replace('### [E3] Third', '### [E3] Third, only after E4')
  md = md + '\n### [E9] Unplaced\nStatus: CLAIMED by codex wt-x, 2026-10-10 09:00\n'
  const items = parse(md)
  const now = Date.parse('2026-10-17T12:00:00')
  const f = audit(items, { md, now })
  const codes = f.map(x => `${x.code}:${x.id}`)
  assert.ok(codes.includes('unblocked:W1'), 'W1 is blocked on E1, which is done')
  assert.ok(codes.includes('prose-dep:E3'))
  assert.ok(codes.includes('ripple-ready:E1'), 'E1 finished 2 h ago and E2 needs only E1')
  assert.ok(codes.includes('stale-claim:E9'))
  assert.ok(codes.includes('unplaced:E9'))
  assert.ok(!codes.some(c => c.startsWith('unplaced:U')), 'the user queue may sit off the timeline')
  assert.equal(f.find(x => x.code === 'unblocked').suggest, 'npm run issue -- reopen W1')
  assert.equal(f[0].level, 'fix')
  const cyc = audit(parse('### [E1] a\nStatus: OPEN\nNeeds: E2\n\n### [E2] b\nStatus: OPEN\nNeeds: E1\n'), {})
  assert.equal(cyc.filter(x => x.code === 'needs-cycle').length, 1)
  assert.ok(audit(parse('x'), { md: 'a\bb\r\n' }).some(x => x.code === 'control-chars'))
})

test('audit: a recent progress update resets the stale-claim clock (2 h bar)', () => {
  const prog = '2026-10-17T11:30:00.000Z'
  const freshMd = `### [E1] x\nStatus: CLAIMED by codex wt-x, 2026-10-10 08:00\nProgress: 50% - halfway\nProgressAt: ${prog}\n`
  const freshNow = Date.parse(prog) + 30 * 60_000
  assert.ok(!audit(parse(freshMd), { md: freshMd, now: freshNow }).some(x => x.code === 'stale-claim'), 'progress 30 min ago is fresh')
  const oldProg = '2026-10-17T08:00:00.000Z'
  const oldMd = `### [E1] x\nStatus: CLAIMED by codex wt-x, 2026-10-10 08:00\nProgress: 50% - halfway\nProgressAt: ${oldProg}\n`
  const oldNow = Date.parse(oldProg) + 3.5 * 3600_000
  assert.ok(audit(parse(oldMd), { md: oldMd, now: oldNow }).some(x => x.code === 'stale-claim'), 'progress 3.5 h ago is stale at the 2 h bar')
})

test('writers: setProgress stamps ProgressAt when given, parses back, stays LF', () => {
  const c = setProgress(LEDGER, 'E2', { percent: 40, text: 'going', at: '2026-10-17T11:30:00.000Z' })
  const e2 = parse(c).find(i => i.id === 'E2')
  assert.equal(e2.percent, 40)
  assert.equal(e2.progressAt, '2026-10-17T11:30:00.000Z')
  assert.ok(!c.includes('\r'))
  const d = setProgress(LEDGER, 'E2', { percent: 40, text: 'going' })
  assert.equal(parse(d).find(i => i.id === 'E2').progressAt, null)
})

test('writers: setNeeds upserts and clears, setRating/setProgress keep the rest of the file, all output LF', () => {
  const crlf = LEDGER.replace(/\n/g, '\r\n')
  const a = setNeeds(crlf, 'E4', ['e1', 'E2'])
  assert.ok(!a.includes('\r'))
  assert.deepEqual(parse(a).find(i => i.id === 'E4').needs, ['E1', 'E2'])
  const b = setNeeds(a, 'E4', [])
  assert.deepEqual(parse(b).find(i => i.id === 'E4').needs, [])
  assert.equal(b.split('\n').length, LEDGER.split('\n').length)
  const c = setRating(setProgress(LEDGER, 'E2', { percent: 40, text: 'going' }), 'E2', { prio: 'P1' })
  const e2 = parse(c).find(i => i.id === 'E2')
  assert.equal(e2.percent, 40)
  assert.equal(e2.prio, 'P1')
  const d = insertItem(LEDGER, { lane: 'E', title: 'New', needs: ['E4'] })
  assert.equal(d.id, 'E5')
  assert.deepEqual(parse(d.md).find(i => i.id === 'E5').needs, ['E4'])
  assert.equal(parse(setStatus(appendNote(LEDGER, 'E2', 'n'), 'E2', 'DROPPED: no')).find(i => i.id === 'E2').state, 'dropped')
})

test('eta: setFields stores Eta, parse reads it, "none" clears it', () => {
  const a = setFields('### [E1] X\nPlain: S.\nStatus: OPEN\n', 'E1', { Eta: '2-3 h' })
  assert.equal(parse(a).find(i => i.id === 'E1').eta, '2-3 h')
  const clr = setFields(a, 'E1', { Eta: '' })
  const it = parse(clr).find(i => i.id === 'E1')
  assert.equal(it.eta, null, 'empty Eta parses as null')
})

test('learn refuses story-like text and appends a parseable lesson', () => {
  assert.ok(storyLike('「これは物語の台詞のような長い日本語の文章です」'))
  assert.ok(storyLike('"' + 'x'.repeat(50) + '"'))
  assert.equal(storyLike('Artemis .pfs archives: 立ち絵 layers are separate PNGs; decode in a worker'), null)
  const dir = mkdtempSync(join(tmpdir(), 'kb-'))
  const file = join(dir, 'LESSONS.md')
  writeFileSync(file, '# Lessons\n\nCurated text.\n')
  appendLesson({ date: '2026-10-18', project: 'sakura', tags: ['wasm'], text: 'sync XHR blocks prefetch', by: 'claude' }, file)
  appendLesson({ date: '2026-10-19', project: 'subahibi', tags: [], text: 'second' }, file)
  const got = recentLessons(10, file)
  assert.equal(got[0].text, 'second')
  assert.deepEqual(got[1], { date: '2026-10-18', project: 'sakura', tags: ['wasm'], text: 'sync XHR blocks prefetch', by: 'claude' })
  assert.throws(() => appendLesson({ date: 'x', project: 'p', text: '「' + 'あ'.repeat(20) + '」' }, file), /refused/)
})

test('kb searches only allowlisted docs, never game-data or re/', () => {
  const root = mkdtempSync(join(tmpdir(), 'kbgame-'))
  mkdirSync(join(root, 'docs'))
  mkdirSync(join(root, 'game-data'))
  mkdirSync(join(root, 're'))
  writeFileSync(join(root, 'HANDOFF.md'), 'texture atlas decision here\n')
  writeFileSync(join(root, 'docs', 'DECISIONS.md'), 'nothing\nTexture Atlas: chose 2048\n')
  writeFileSync(join(root, 'docs', 'notes.md'), 'texture atlas not allowlisted\n')
  writeFileSync(join(root, 'game-data', 'x.md'), 'texture atlas secret\n')
  writeFileSync(join(root, 're', 'DECISIONS.md'), 'texture atlas secret\n')
  const files = kbFiles([{ id: 'g', root }]).filter(f => f.label === 'g')
  const hits = kbSearch('texture atlas', files)
  assert.deepEqual(hits.map(h => [h.path.slice(root.length).replace(/\\/g, '/'), h.line]), [['/docs/DECISIONS.md', 2], ['/HANDOFF.md', 1]])
})

test('kb ranks lessons and decisions before current state and still finds history-only evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kb-rank-'))
  const contents = [
    ['HISTORY.md', 'only history archived checkpoint proof'],
    ['BACKLOG.md', 'active ticket ledger'],
    ['HANDOFF.md', 'current recovery state'],
    ['DECISIONS.md', 'technical decision'],
    ['LESSONS.md', 'shared lesson'],
  ]
  const files = contents.map(([name, text]) => {
    const path = join(dir, name)
    writeFileSync(path, text + '\n')
    return { label: 'game', path }
  })
  const ranked = rankKbFiles(files)
  assert.deepEqual(ranked.map(file => file.path.slice(dir.length + 1)),
    ['DECISIONS.md', 'LESSONS.md', 'HANDOFF.md', 'HISTORY.md', 'BACKLOG.md'])
  assert.deepEqual(kbSearch('only history archived checkpoint proof', ranked).map(hit => [hit.path.slice(dir.length + 1), hit.line]),
    [['HISTORY.md', 1]])
})

test('the CLI edits the ledger of the checkout given by --root, claims are guarded, next/audit/goal run', () => {
  const root = mkdtempSync(join(tmpdir(), 'issue-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), LEDGER.replace(/\n/g, '\r\n'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'p', private: true, scripts: { ok: 'node -e "process.exit(0)"' } }))
  const run = (...a) => execFileSync(process.execPath, [ISSUE, '--root', root, ...a], { encoding: 'utf8', cwd: root })
  assert.match(run('next', '--agent', 'claude'), /^next: E2/m)
  assert.match(run('goal'), /You are here: \[S1\]/)
  assert.match(run('audit'), /W1 is BLOCKED but E1 is done/)
  run('claim', 'E2', '--by', 'claude wt-test')
  assert.throws(() => execFileSync(process.execPath, [ISSUE, '--root', root, 'claim', 'E2', '--by', 'codex'], { stdio: 'pipe' }))
  assert.throws(() => execFileSync(process.execPath, [ISSUE, '--root', root, 'claim', 'U1', '--by', 'codex'], { stdio: 'pipe' }))
  run('needs', 'E4', 'E2')
  assert.match(run('done', 'E2', '--commit', 'abcdef1'), /ripple: E2 done -> now ready: E3, E4/)
  run('note', 'E3', '2026-10-18 12:00 starts with a date')
  run('drop', 'E4', '--reason', 'not needed')
  const md = readFileSync(join(root, 'docs', 'BACKLOG.md'), 'utf8')
  assert.ok(!md.includes('\r'), 'writes are LF')
  const items = parse(md)
  assert.equal(items.find(i => i.id === 'E2').state, 'done')
  assert.equal(items.find(i => i.id === 'E4').state, 'dropped')
  assert.ok(!/\d{4}-\d{2}-\d{2} \d{2}:\d{2} 2026-10-18/.test(items.find(i => i.id === 'E3').notes[0]), 'no doubled date')
})
