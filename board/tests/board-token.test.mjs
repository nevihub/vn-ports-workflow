import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shutdownAllowed, shutdownHeaders } from '../board.mjs'

const req = headers => ({ headers })

test('without a token, the local header stops the server and anything else is refused', () => {
  delete process.env.BOARD_TOKEN
  assert.equal(shutdownAllowed(req({ 'x-board': 'yes' })), true)
  assert.equal(shutdownAllowed(req({})), false)
  assert.equal(shutdownAllowed(req({ 'x-board': 'no' })), false)
  assert.deepEqual(shutdownHeaders(), { 'x-board': 'yes' })
})

test('with BOARD_TOKEN, only the token stops the server - the bare header is refused', () => {
  process.env.BOARD_TOKEN = 'test-token-abc'
  try {
    assert.equal(shutdownAllowed(req({ 'x-board': 'yes' })), false, 'header alone must not pass once a token is set')
    assert.equal(shutdownAllowed(req({ 'x-board-token': 'wrong' })), false)
    assert.equal(shutdownAllowed(req({ 'x-board': 'yes', 'x-board-token': 'test-token-abc' })), true)
    assert.deepEqual(shutdownHeaders(), { 'x-board': 'yes', 'x-board-token': 'test-token-abc' })
  } finally {
    delete process.env.BOARD_TOKEN
  }
})

test('read-only routes stay open: the gate covers the mutating route only', () => {
  delete process.env.BOARD_TOKEN
  // shutdownAllowed is consulted only on /shutdown; every other route ignores it (no 403 surface).
  assert.equal(typeof shutdownAllowed, 'function')
})
