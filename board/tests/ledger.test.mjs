import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { history, lastNoteAt, parse, summarise, timeline } from '../lib/ledger.mjs'
import { collect, loadProjects, overview } from '../board.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const LEDGER = `# Backlog

## Timeline

### [S0] Research
Plain: Read everything first.
Status: DONE 2026-10-17
Weight: 10

### [S1] Starts
Plain: The game starts.
Tickets: E1, E2
Weight: 30

### [S2] Playable
Plain: You can play it.
Tickets: E3, U1
Weight: 60
Playable: yes

## Lanes

### Lane E

### [E1] Boot
Plain: boot fix
Status: DONE 2026-10-17 15:00, abc1234 - fixed
Notes:
- 2026-10-17 14:00 agent: started

### [E2] Pictures
Plain: draw pictures
Status: CLAIMED by OpenCode round7, 2026-10-17 20:38
Progress: 50% - halfway

### [E3] Live play
Plain: live loop
Status: OPEN

### [E9] Unplaced
Status: OPEN

### Lane U

### [U1] Phone check
Plain: try it on a phone
Status: OPEN
`

test('parse reads stage fields: Tickets, Weight, Playable, explicit Status', () => {
  const items = parse(LEDGER)
  const s1 = items.find(i => i.id === 'S1')
  assert.deepEqual(s1.tickets, ['E1', 'E2'])
  assert.equal(s1.weight, 30)
  assert.equal(items.find(i => i.id === 'S2').playableStage, true)
  const s0 = items.find(i => i.id === 'S0')
  assert.equal(s0.state, 'done')
  assert.equal(s0.hasStatus, true)
  assert.equal(items.find(i => i.id === 'S1').hasStatus, false)
})

test('summarise skips stages and counts the user queue once', () => {
  const s = summarise(parse(LEDGER))
  assert.deepEqual(s, { total: 5, open: 2, claimed: 1, blocked: 0, done: 1, dropped: 0, user: 1 })
})

test('timeline: stage percent, state, overall, here, playable, unplaced', () => {
  const items = parse(LEDGER).map(i => ({ ...i, at: i.date ? Date.parse(`${i.date}T${i.time ?? '00:00'}:00`) : null }))
  const tl = timeline(items)
  const [s0, s1, s2] = tl.stages
  assert.equal(s0.state, 'done'); assert.equal(s0.percent, 100)
  assert.equal(s1.state, 'active'); assert.equal(s1.percent, 75) // (1 + 0.5) / 2
  assert.equal(s2.state, 'next'); assert.equal(s2.percent, 0)
  assert.equal(s2.waitingOnYou, 1)
  assert.equal(tl.overall, Math.round((10 * 100 + 30 * 75 + 60 * 0) / 100)) // 33
  assert.equal(tl.here, 'S1')
  assert.equal(tl.playable.yes, false)
  assert.deepEqual(tl.playable.missing.map(m => m.id), ['E3', 'U1'])
  assert.deepEqual(tl.unplaced, ['E9'])
  assert.equal(s1.startedAt, Date.parse('2026-10-17T15:00:00'))
  assert.equal(s1.finishedAt, null)
})

test('timeline: a stage whose tickets are all done is done, dropped tickets do not count', () => {
  const md = '## Timeline\n\n### [S0] A\nTickets: E1, E2\nWeight: 100\nPlayable: yes\n\n## Lanes\n\n### [E1] x\nStatus: DONE 2026-10-17\n\n### [E2] y\nStatus: DROPPED: not needed\n'
  const tl = timeline(parse(md).map(i => ({ ...i, at: i.date ? Date.parse(`${i.date}T00:00:00`) : null })))
  assert.equal(tl.stages[0].state, 'done')
  assert.equal(tl.overall, 100)
  assert.equal(tl.playable.yes, true)
  assert.equal(tl.here, null)
})

test('timeline: a ticket named on a stage but missing from the ledger is shown as missing', () => {
  const md = '## Timeline\n\n### [S0] A\nTickets: E7\nWeight: 100\n'
  const tl = timeline(parse(md))
  assert.equal(tl.stages[0].tickets[0].missing, true)
  assert.equal(tl.stages[0].percent, 0)
})

test('lastNoteAt and history pick dated notes and finished tickets, newest first', () => {
  assert.equal(lastNoteAt(['2026-10-17: a', '2026-10-17 20:54 b: c', 'undated']), Date.parse('2026-10-17T20:54:00'))
  const items = parse(LEDGER).map(i => ({ ...i, at: i.state === 'done' ? Date.parse('2026-10-17T15:00:00') : null }))
  const h = history(items)
  assert.equal(h[0].kind, 'done'); assert.equal(h[0].id, 'E1')
  assert.equal(h[1].kind, 'note'); assert.equal(h[1].timed, true)
})

function fixtureProject (name, md, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), `vnboard-${name}-`))
  if (md) { mkdirSync(join(dir, 'docs')); writeFileSync(join(dir, 'docs', 'BACKLOG.md'), md) }
  for (const [f, text] of Object.entries(extra)) writeFileSync(join(dir, f), text)
  return dir
}

test('collect + overview over fixture projects: timeline game, ledger without timeline, no-ledger game', () => {
  const a = fixtureProject('a', LEDGER)
  const b = fixtureProject('b', '## Lanes\n\n### [E1] x\nPlain: p\nStatus: OPEN\n', { 'HANDOFF.md': '**Playable: yes**. **Progress:** ~89%. https://b.example' })
  const c = fixtureProject('c', null, { 'STATUS.md': 'Live: https://c.example/ Progress 96.6% overall' })
  const cfg = join(mkdtempSync(join(tmpdir(), 'vnboard-cfg-')), 'projects.json')
  writeFileSync(cfg, JSON.stringify({ projects: [
    { id: 'a', name: 'A', paths: [a] },
    { id: 'b', name: 'B', paths: ['./nope', b], fallback: { file: 'HANDOFF.md', playable: 'Playable:\\s*\\**\\s*([A-Za-z]+)', progress: 'Progress:\\s*\\**\\s*~?(\\d+)\\s*%' } },
    { id: 'c', name: 'C', paths: [c], live: { file: 'STATUS.md', regex: '(https://c\\.example/?)' }, fallback: { file: 'STATUS.md', playableIfLive: true, progress: 'Progress\\s+([\\d.]+)%' } },
    { id: 'd', name: 'D', paths: [join(c, 'missing')] },
  ] }))
  const projects = loadProjects(cfg)
  assert.equal(projects[1].root, b)
  assert.equal(projects[3].root, null)
  const da = collect(projects[0], { now: Date.parse('2026-10-18T09:00:00') })
  assert.equal(da.overall, 33)
  assert.equal(da.overallSource, 'timeline')
  assert.equal(da.playable.text, 'not yet')
  assert.ok(da.items.every(i => i.lane !== 'S'))
  assert.equal(da.items.find(i => i.id === 'E2').staleHours, 12) // claimed 20:38, no later note, now 09:00
  const db = collect(projects[1])
  assert.equal(db.overall, 89); assert.equal(db.overallSource, 'handoff'); assert.equal(db.playable.yes, true)
  const dc = collect(projects[2])
  assert.equal(dc.hasLedger, false); assert.equal(dc.overall, 97); assert.equal(dc.playable.yes, true); assert.equal(dc.live, 'https://c.example/')
  const ov = overview(projects)
  assert.equal(ov.length, 4)
  assert.equal(ov[0].here.id, 'S1')
  assert.equal(ov[3].found, false)
})

test('the real projects.json loads and every project has an id, a name and candidate paths', () => {
  const cfg = JSON.parse(readFileSync(join(HERE, '..', 'projects.json'), 'utf8'))
  const ids = new Set()
  for (const p of cfg.projects) {
    assert.ok(p.id && p.name && p.paths?.length, `project ${p.id} is complete`)
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`)
    ids.add(p.id)
  }
})

test('every real ledger with a timeline: weights sum to 100, stage tickets exist, each non-U ticket sits in one stage', () => {
  for (const p of loadProjects()) {
    const file = p.root && join(p.root, 'docs', 'BACKLOG.md')
    if (!file || !existsSync(file)) continue
    const items = parse(readFileSync(file, 'utf8'))
    const stages = items.filter(i => i.lane === 'S')
    if (!stages.length) continue
    assert.equal(stages.reduce((a, s) => a + (s.weight ?? 0), 0), 100, `${p.id}: weights sum to 100`)
    const ids = new Set(items.filter(i => i.lane !== 'S').map(i => i.id))
    const seen = new Map()
    for (const s of stages) for (const t of s.tickets) {
      assert.ok(ids.has(t), `${p.id}: ${s.id} names ${t}, which is not in the ledger`)
      assert.ok(!seen.has(t), `${p.id}: ${t} sits in both ${seen.get(t)} and ${s.id}`)
      seen.set(t, s.id)
    }
    for (const it of items) {
      if (it.lane === 'S' || it.lane === 'U' || it.state === 'dropped') continue
      assert.ok(seen.has(it.id), `${p.id}: ${it.id} is not on the timeline`)
    }
  }
})
