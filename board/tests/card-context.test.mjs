import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collect } from '../board.mjs'
import { elsewhereClaims, parse } from '../lib/ledger.mjs'
import { recoveryCards } from '../lib/recovery.mjs'

const ISSUE = fileURLToPath(new URL('../issue.mjs', import.meta.url))

test('new cards keep an exact creation time; claims, completion and review preserve it and unrelated text', () => {
  const root = mkdtempSync(join(tmpdir(), 'card-context-'))
  mkdirSync(join(root, 'docs'))
  const file = join(root, 'docs', 'BACKLOG.md')
  writeFileSync(file, '# Backlog\n\n### Lane E\n\n### [E1] Existing\nStatus: OPEN\nPlain: Keep me.\n')
  const cli = (...args) => execFileSync(process.execPath, [ISSUE, '--root', root, ...args], { encoding: 'utf8', cwd: root })
  cli('new', 'New task', '--lane', 'E', '--plain', 'Load a small fixture.', '--by', 'codex')
  const first = parse(readFileSync(file, 'utf8')).find(i => i.id === 'E2')
  assert.ok(Number.isFinite(Date.parse(first.created)))
  assert.equal(first.createdBy, 'codex')
  cli('claim', 'E2', '--by', 'codex isolated', '--model', 'gpt-6.1-sol')
  cli('done', 'E2', '--note', 'Small downloads now work.', '--before', 'The whole fixture loaded.', '--after', 'Only requested pieces load.', '--evidence', '9 requests; no speed baseline recorded.')
  const closed = parse(readFileSync(file, 'utf8')).find(i => i.id === 'E2')
  assert.equal(closed.created, first.created)
  assert.equal(closed.model, 'gpt-6.1-sol')
  assert.equal(closed.result, 'Small downloads now work.')
  assert.equal(closed.before, 'The whole fixture loaded.')
  cli('block', 'E1', '--reason', 'Needs a new fixture')
  cli('recovery', 'E1', '--unblock', 'Verify E2 first.', '--related', 'E2', '--topics', 'delivery')
  cli('reviewed', 'E1', 'Fixture still missing; no retry made.')
  const it = parse(readFileSync(file, 'utf8')).find(i => i.id === 'E1')
  assert.equal(it.state, 'blocked')
  assert.ok(it.reviewed)
  assert.deepEqual(it.related, ['E2'])
  assert.equal(it.plain, 'Keep me.')
  cli('reopen', 'E2')
  cli('claim', 'E2', '--by', 'claude other-session')
  assert.equal(parse(readFileSync(file, 'utf8')).find(i => i.id === 'E2').model, null, 'a new claimant must not inherit the last model')
})

test('recovery shows completed and active links, new knowledge and messages without changing the blocked state', () => {
  const items = parse(`### [E10] Fetch ahead\nStatus: BLOCKED: waits for E12\nNeeds: E12\nRelated: E13\nTopics: worker, timing\nReviewed: 2026-10-10T10:00:00Z\nUnblock: Verify the worker yields between frames.\n### [E12] Worker\nPlain: Keep the page responsive.\nStatus: DONE 2026-10-18\nResult: Frames run in a worker.\n### [E13] Timing\nStatus: CLAIMED by codex\n### [U1] Owner\nStatus: BLOCKED: owner only\n`)
  const original = JSON.stringify(items)
  const plans = recoveryCards(items, {
    now: Date.parse('2026-10-18T12:00:00Z'),
    lessons: [{ date: '2026-10-18', project: 'other-port', tags: ['worker'], text: 'Yield between steps.' }],
    messages: [
      { channel: 'sakura', ticket: 'E12', at: Date.parse('2026-10-18T11:00:00Z'), text: 'Worker complete.' },
      { channel: 'all', ticket: 'E12', at: Date.now(), text: 'Ambiguous ticket from another game.' },
      { channel: 'sakura', ticket: 'E99', at: Date.now(), text: 'Unrelated.' },
      { channel: 'all', ticket: null, at: Date.parse('2026-10-18T11:00:00Z'), text: 'Another port measured the worker yield.' },
    ],
  })
  assert.equal(plans.length, 1, 'U tickets are not agent recovery work')
  assert.deepEqual(plans[0].related.map(t => t.state), ['done', 'claimed'])
  assert.equal(plans[0].messages.length, 2, 'cross-port topic leads count, ambiguous ticket numbers do not')
  assert.equal(plans[0].lessons.length, 1)
  assert.ok(plans[0].signals.some(s => /prerequisites are finished/.test(s)))
  assert.ok(plans[0].signals.some(s => /week/.test(s)))
  assert.equal(JSON.stringify(items), original)
})

test('collect and worktree overlays retain completion details, explicit models and creation provenance', () => {
  const root = mkdtempSync(join(tmpdir(), 'card-collect-'))
  mkdirSync(join(root, 'docs'))
  const md = '### [E1] Draw\nStatus: DONE 2026-10-18 - technical note\nCreated: 2026-10-17T22:13:00Z\nModel: gpt-6.1-sol\nResult: Pictures now draw.\nBefore: Empty canvas.\nAfter: Visible fixture.\nEvidence: 35 matching frames.\n'
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), md)
  const result = collect({ id: 'fixture', name: 'Fixture', root }).items[0]
  assert.equal(result.note, 'technical note')
  assert.equal(result.result, 'Pictures now draw.')
  assert.equal(result.before, 'Empty canvas.')
  assert.equal(result.created, '2026-10-17T22:13:00Z')
  const other = elsewhereClaims(parse('### [E1] Draw\nStatus: OPEN\n'), [{ name: 'wt', md }]).claims.get('E1')
  assert.equal(other.model, result.model)
  assert.equal(other.evidence, result.evidence)
})
