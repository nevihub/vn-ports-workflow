import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeMaintainer, dirtyCheckout, parseStaleClaim, buildNudges } from '../lib/maintainer.mjs'

test('summarizeMaintainer splits merge queue, ghosts, stale and thinking', () => {
  const items = [
    { id: 'E1', state: 'done', notMerged: true, worktree: 'lane-a', branch: 'b/a', owner: 'opencode lane-a', at: 100 },
    { id: 'E2', state: 'done', notMerged: false },
    { id: 'E9', state: 'blocked', notMerged: true, ghost: true, worktree: 'lane-b', branch: 'b/b' },
    { id: 'E3', state: 'claimed', staleHours: 5, owner: 'codex wt' },
  ]
  const messages = [
    { by: 'opencode lane-a', kind: 'handoff', text: 'E1 done', at: 200 },
    { by: 'maintainer spark', kind: 'heads-up', text: 'maintainer sweep: subahibi 1 done-not-merged', at: 300 },
  ]
  const m = summarizeMaintainer({ items, messages })
  assert.deepEqual(m.mergeQueue.map(q => q.id), ['E1'])
  assert.deepEqual(m.ghosts.map(g => g.id), ['E9'])
  assert.deepEqual(m.stale.map(s => s.id), ['E3'])
  assert.equal(m.thinking.length, 1)
  assert.equal(m.lastSweepAt, 300)
})

test('summarizeMaintainer dedupes ghosts by card id', () => {
  const items = [
    { id: 'E10', state: 'done', notMerged: true, ghost: true, worktree: 'lane-a', branch: 'b/a' },
    { id: 'E10', state: 'done', notMerged: true, ghost: true, worktree: 'lane-c', branch: 'b/c' },
    { id: 'E9', state: 'blocked', notMerged: true, ghost: true, worktree: 'lane-b', branch: 'b/b' },
  ]
  const m = summarizeMaintainer({ items, messages: [] })
  assert.deepEqual(m.ghosts.map(g => g.id), ['E10', 'E9'])
  assert.equal(m.ghosts[0].worktree, 'lane-a')
})

test('summarizeMaintainer with no maintainer posts has no thinking', () => {
  const m = summarizeMaintainer({ items: [], messages: [{ by: 'claude', text: 'hello', at: 1 }] })
  assert.deepEqual(m.thinking, [])
  assert.equal(m.lastSweepAt, null)
})

test('dirtyCheckout on a missing folder reports clean', () => {
  assert.deepEqual(dirtyCheckout('C:/no-such-folder-xyz'), { count: 0, lines: [] })
  assert.deepEqual(dirtyCheckout(null), { count: 0, lines: [] })
})

test('parseStaleClaim reads the audit stale-claim text', () => {
  assert.deepEqual(parseStaleClaim({ code: 'stale-claim', id: 'E3', text: 'E3 claimed by opencode lane-x with no update for 26 h' }),
    { id: 'E3', owner: 'opencode lane-x', staleHours: 26 })
  assert.equal(parseStaleClaim({ code: 'done-elsewhere', text: 'whatever' }), null)
  assert.equal(parseStaleClaim({ code: 'stale-claim', text: 'garbage' }), null)
})

test('buildNudges nudges old quiet claims once each', () => {
  const findings = [
    { code: 'stale-claim', id: 'E3', text: 'E3 claimed by opencode lane-x with no update for 26 h' },
    { code: 'stale-claim', id: 'W1', text: 'W1 claimed by codex wt with no update for 5 h' },
    { code: 'stale-claim', id: 'V1', text: 'V1 claimed by codex wt with no update for 3 h' },
    { code: 'done-elsewhere', id: 'E2', text: 'E2 done elsewhere' },
  ]
  const nudges = buildNudges({ findings, messages: [] })
  assert.deepEqual(nudges.map(n => n.id), ['E3', 'W1'])
  assert.equal(nudges[0].kind, 'question')
  assert.match(nudges[0].text, /maintainer nudge: E3 claimed by opencode lane-x, no update for 26h/)
  assert.ok(nudges[0].text.length <= 600)
})

test('buildNudges never nudges the same card twice', () => {
  const findings = [{ code: 'stale-claim', id: 'E3', text: 'E3 claimed by opencode lane-x with no update for 26 h' }]
  const messages = [{ ticket: 'E3', by: 'maintainer spark', kind: 'question', text: 'maintainer nudge: E3 claimed by opencode lane-x, no update for 20h. Still on it?' }]
  assert.deepEqual(buildNudges({ findings, messages }), [])
})
