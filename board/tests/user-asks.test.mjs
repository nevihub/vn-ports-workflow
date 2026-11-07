import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parse } from '../lib/ledger.mjs'
import { userAsks } from '../lib/project-state.mjs'

test('userAsks finds user-only blockers on non-U cards and defers U cards whose needs are open', () => {
  const items = parse([
    '### [W3] Install',
    'Status: CLAIMED by codex, 2026-11-07 11:04',
    'Eta: after user-only oracle-lock',
    'Unblock: User reviews the new proof and runs npm run issue -- oracle-lock --by user.',
    '### [E19] Textures',
    'Status: BLOCKED: OpenCode hit usage limits before edits',
    '### [E29] Stream',
    'Status: BLOCKED: seven attempts failed; no user listening result',
    'Unblock: Independently verify terminal-stream reporting.',
    '### [U4] Phone sound',
    'Plain: Test sound on your phone.',
    'Status: OPEN',
    '### [U5] Home screen',
    'Plain: Add it to your home screen.',
    'Status: OPEN',
    'Needs: W3',
  ].join('\n'))
  const asks = userAsks(items)
  assert.deepEqual(asks.now.map(a => a.id), ['W3', 'E19', 'U4'])
  assert.deepEqual(asks.later, [{ id: 'U5', ask: 'Add it to your home screen.', after: ['W3'] }])
})
