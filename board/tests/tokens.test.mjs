import test from 'node:test'
import assert from 'node:assert/strict'
import { claudeUsage, promptPercentile, summarizePrompts } from '../lib/token-usage.mjs'

test('Claude usage sums uncached, cache-read, and cache-write prompt tokens', () => {
  const row = claudeUsage({
    type: 'assistant',
    session_id: 'private-session-id',
    timestamp: '2026-11-03T12:00:00.000Z',
    message: {
      id: 'private-message-id',
      usage: { input_tokens: 12, cache_read_input_tokens: 30, cache_creation_input_tokens: 50 },
    },
  })

  assert.equal(row.prompt, 92)
  assert.equal(row.timestampMs, Date.parse('2026-11-03T12:00:00.000Z'))
  assert.equal(row.sessionId, 'private-session-id')
  assert.equal(row.requestId, 'private-message-id')
})

test('Claude usage ignores rows without assistant usage fields', () => {
  assert.equal(claudeUsage({ type: 'user', message: { usage: { input_tokens: 10 } } }), null)
  assert.equal(claudeUsage({ type: 'assistant', message: { content: [] } }), null)
})

test('prompt summaries include average, interpolated percentiles, and threshold shares', () => {
  assert.deepEqual(summarizePrompts([100_000, 128_000, 200_001]), {
    requests: 3,
    avgPrompt: 142_667,
    p50Prompt: 128_000,
    p90Prompt: 185_601,
    over128k: 1,
    over128kPct: 33.3,
    over200k: 1,
    over200kPct: 33.3,
  })
  assert.equal(promptPercentile([], 0.5), null)
  assert.deepEqual(summarizePrompts([]), {
    requests: 0, avgPrompt: 0, p50Prompt: 0, p90Prompt: 0,
    over128k: 0, over128kPct: 0, over200k: 0, over200kPct: 0,
  })
})
