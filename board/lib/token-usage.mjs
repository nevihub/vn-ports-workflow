const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0

export function promptPercentile (values, fraction) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const position = (sorted.length - 1) * fraction
  const low = Math.floor(position)
  const high = Math.ceil(position)
  return Math.round(sorted[low] + (sorted[high] - sorted[low]) * (position - low))
}

export function summarizePrompts (values) {
  const prompts = values.filter(Number.isFinite)
  const over128k = prompts.filter(n => n > 128_000).length
  const over200k = prompts.filter(n => n > 200_000).length
  const total = prompts.reduce((sum, n) => sum + n, 0)
  const pct = count => prompts.length ? Number((100 * count / prompts.length).toFixed(1)) : 0
  return {
    requests: prompts.length,
    avgPrompt: prompts.length ? Math.round(total / prompts.length) : 0,
    p50Prompt: promptPercentile(prompts, 0.5) ?? 0,
    p90Prompt: promptPercentile(prompts, 0.9) ?? 0,
    over128k: over128k,
    over128kPct: pct(over128k),
    over200k: over200k,
    over200kPct: pct(over200k),
  }
}

export function claudeUsage (record) {
  if (record?.type !== 'assistant') return null
  const usage = record.message?.usage ?? record.usage
  if (!usage || typeof usage !== 'object') return null
  const fields = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']
  if (!fields.some(key => Object.hasOwn(usage, key))) return null
  const prompt = fields.reduce((sum, key) => sum + finite(usage[key]), 0)
  const timestamp = record.timestamp ?? record.message?.timestamp
  const timestampMs = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp)
  return {
    prompt,
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
    sessionId: record.sessionId ?? record.session_id ?? null,
    requestId: record.message?.id ?? record.requestId ?? record.request_id ?? record.uuid ?? null,
  }
}
