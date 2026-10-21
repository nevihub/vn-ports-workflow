// Read-only leads for blocked tickets. A lead never changes status or relaxes a Gate.
const refs = text => [...String(text ?? '').matchAll(/\b[A-Z]{1,2}\d+\b/g)].map(m => m[0])
const ms = value => Date.parse(value ?? '') || 0

export function recoveryCards (items, { messages = [], lessons = [], now = Date.now() } = {}) {
  const byId = new Map(items.map(it => [it.id, it]))
  return items.filter(it => it.state === 'blocked' && it.lane !== 'U').map(it => {
    const dependencies = [...new Set([...(it.needs ?? []), ...refs(it.reason)])]
      .filter(id => id !== it.id && byId.has(id))
    const linked = [...new Set([...dependencies, ...(it.related ?? [])])].filter(id => id !== it.id && byId.has(id))
    const related = linked.map(id => {
      const t = byId.get(id)
      return { id, state: t.state, plain: t.plain ?? t.title, result: t.result ?? null, dependency: dependencies.includes(id) }
    })
    const since = ms(it.reviewed ?? it.blockedAt)
    const context = `${it.title} ${it.reason ?? ''} ${it.unblock ?? ''} ${(it.topics ?? []).join(' ')}`.toLowerCase()
    const matchingLessons = lessons.filter(l => l.tags?.some(tag => tag.length > 2 && context.includes(tag.toLowerCase()))).slice(0, 5)
    const matchingMessages = messages.filter(m => m.channel === 'all'
      ? (it.topics ?? []).some(topic => topic.length > 3 && String(m.text).toLowerCase().includes(topic))
      : m.ticket && (m.ticket === it.id || linked.includes(m.ticket))).slice(0, 6)
    const signals = []
    if (dependencies.length && dependencies.every(id => byId.get(id).state === 'done')) signals.push('The named prerequisites are finished. Review the remaining gate before reopening.')
    if (since && linked.some(id => {
      const t = byId.get(id)
      const finished = t.at ?? ms(t.date ? `${t.date}T${t.time ?? '00:00'}:00` : null)
      return t.state === 'done' && finished > since
    })) signals.push('A related card finished since the last review.')
    if (since && matchingMessages.some(m => m.at > since)) signals.push('There are newer agent messages to check.')
    if (since && matchingLessons.some(l => l.date > new Date(since).toISOString().slice(0, 10))) signals.push('There is newer shared knowledge to check.')
    if (since && now - since >= 7 * 86400_000) signals.push('This card has not been reviewed for at least a week.')
    return { id: it.id, unblock: it.unblock ?? 'Record the missing evidence or change that would allow another attempt.',
      related, lessons: matchingLessons, messages: matchingMessages, signals, reviewed: it.reviewed ?? null,
      blockedAt: it.blockedAt ?? null, needsPlan: !it.unblock }
  })
}

export const recoveryFindings = plans => plans.filter(p => p.signals.length).map(p => ({
  level: 'check', code: 'recovery-review', id: p.id, text: `${p.id}: ${p.signals.join(' ')}`,
  suggest: `npm run issue -- rescue ${p.id}`,
}))
