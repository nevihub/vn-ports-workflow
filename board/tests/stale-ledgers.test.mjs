import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audit } from '../lib/audit.mjs'
import { elsewhereClaims, parse } from '../lib/ledger.mjs'
import { recoveryCards } from '../lib/recovery.mjs'

const MAIN = '### [E1] a\nStatus: OPEN\n\n### [E2] b\nStatus: OPEN\n'
const WT = '### [E1] a\nStatus: BLOCKED - waits on frames\n\n### [E2] b\nStatus: CLAIMED by codex wt-x, 2026-10-10 08:00\n'

test('elsewhereClaims: a merged worktree no longer hides tickets here', () => {
  const main = parse(MAIN)
  assert.deepEqual([...elsewhereClaims(main, [{ name: 'wt', md: WT }]).claims.keys()].sort(), ['E1', 'E2'])
  assert.equal(elsewhereClaims(main, [{ name: 'wt', md: WT, merged: true }]).claims.size, 0)
})

test('elsewhereClaims: a review here newer than the worktree copy supersedes it', () => {
  const wt = '### [E1] a\nStatus: BLOCKED - waits on frames\nReviewed: 2026-10-10T00:00:00.000Z\n'
  const main = r => parse(`### [E1] a\nStatus: OPEN\nReviewed: ${r}\n`)
  assert.equal(elsewhereClaims(main('2026-10-09T00:00:00.000Z'), [{ name: 'wt', md: wt }]).claims.size, 1)
  assert.equal(elsewhereClaims(main('2026-10-11T00:00:00.000Z'), [{ name: 'wt', md: wt }]).claims.size, 0)
})

test('audit: a quiet claim in another worktree is a stale claim', () => {
  const main = parse(MAIN)
  const { claims } = elsewhereClaims(main, [{ name: 'wt', md: WT }])
  const f = audit(main, { md: MAIN, elsewhere: claims, now: Date.parse('2026-10-17T12:00:00') })
  const stale = f.find(x => x.code === 'stale-claim' && x.id === 'E2')
  assert.ok(stale, 'E2 claimed a week ago in wt')
  assert.match(stale.text, /worktree wt/)
  assert.ok(!f.some(x => x.code === 'stale-claim' && x.id === 'E1'), 'a block is not a claim')
})

test('audit: a dependent reviewed after the finish is not rippled again', () => {
  const md = (reviewed = '') => '## Timeline\n\n### [S1] s\nTickets: E1, E2, E3\nWeight: 100\n\n## Lanes\n\n' +
    '### [E1] a\nStatus: DONE 2026-10-17 10:00, abc1234 - landed\n\n' +
    `### [E2] b\nStatus: OPEN\nNeeds: E1\n${reviewed}\n` +
    `### [E3] c\nStatus: OPEN\n${reviewed}`
  const now = Date.parse('2026-10-17T12:00:00')
  const before = audit(parse(md()), { now }).map(x => x.code)
  assert.ok(before.includes('ripple-ready') && before.includes('ripple-stage'))
  const after = audit(parse(md(`Reviewed: ${new Date(Date.parse('2026-10-17T11:00:00')).toISOString()}\n`)), { now }).map(x => x.code)
  assert.ok(!after.includes('ripple-ready') && !after.includes('ripple-stage'))
})

test('recovery: finished prerequisites stop asking for a review once one postdates them', () => {
  const md = reviewed => '### [E1] a\nStatus: DONE 2026-10-10 10:00, abc1234 - landed\n\n' +
    `### [E2] b\nStatus: BLOCKED - needs frames\nNeeds: E1\nUnblock: frames\n${reviewed ? `Reviewed: ${reviewed}\n` : ''}`
  const signals = r => recoveryCards(parse(md(r)), { now: Date.parse('2026-10-12T00:00:00') })[0].signals
  assert.ok(signals(null).some(s => /prerequisites are finished/.test(s)), 'never reviewed')
  assert.ok(signals('2026-10-09T00:00:00.000Z').some(s => /prerequisites are finished/.test(s)), 'reviewed before E1 finished')
  assert.ok(!signals('2026-10-11T00:00:00.000Z').some(s => /prerequisites are finished/.test(s)), 'reviewed after E1 finished')
})
