// Read-only view of a project's task ledger (docs/BACKLOG.md) for the shared VN Ports board.
// Ticket items: `### [ID] Title` headings, the ID is a lane letter + number. Fields are plain lines under the heading,
// bold tolerated:
//   Status: OPEN | CLAIMED by <who[, where]>, <date[ HH:MM]> | BLOCKED: <reason> | DONE <date[ HH:MM]>[, <commit>] - <note> | DROPPED: <reason>
//   Plain: <one jargon-free sentence>   Type: <task|bug|perf|verify|user>   Prio: P1..P3   Impact / Worth / Progress
//   Gate: <one line>   Notes: bullets `- <date> <who>: <text>`
//   Needs: E1, M2 (tickets that must be DONE first)   Agents: claude, codex (who may take it; default: projects.json)
//   Proof: npm run <script> [args] (the command `issue done` runs; it must pass before the ticket closes)
//   Eta: <free text, e.g. "2-3 h" - the agent's own estimate when claiming, refreshed with `issue eta <ID> <text>`>
// Timeline stages are items in lane S (`### [S0] Research` ... under `## Timeline`):
//   Tickets: E1, E2, U4   Weight: <share of the whole project, all weights sum to 100>   Playable: yes (optional, marks
//   the stage whose completion means "playable")   Status: DONE <date> (optional, for stages without tickets)
// This module never writes; the one writer is lib/backlog.mjs (the `npm run issue` CLI, issue.mjs). CRLF tolerated.

const HEADING = /^### \[([A-Z]{1,2}\d+)\]\s+(.+?)\s*$/
const FIELD = /^\**([A-Za-z]+)\**:\s*(.*)$/
const BULLET = /^\s*-\s+(.+?)\s*$/
const SECTION = /^#{2,3}\s/

const plain = s => s.replace(/^\*+\s*/, '').replace(/\s*\*+$/, '').trim()
const ids = v => v.split(/[\s,]+/).map(t => t.toUpperCase()).filter(t => /^[A-Z]{1,2}\d+$/.test(t))

function parseStatus (text) {
  const raw = plain(text)
  const stamp = raw.match(/\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?/)?.[0] ?? null
  const date = stamp?.slice(0, 10) ?? null
  const time = stamp && stamp.length > 10 ? stamp.slice(11, 16) : null
  const s = { state: 'open', raw, date, time, owner: null, reason: null, commit: null, note: null }
  if (/^claimed\b/i.test(raw)) {
    s.state = 'claimed'
    s.owner = plain(raw.replace(/^claimed\s*(?:by\s*)?/i, '').replace(stamp ?? '@@no-date@@', '').replace(/[\s,]+$/, ''))
  } else if (/^blocked\b/i.test(raw)) {
    s.state = 'blocked'
    s.reason = plain(raw.replace(/^blocked:?\s*/i, ''))
  } else if (/^dropped\b/i.test(raw)) {
    s.state = 'dropped'
    s.reason = plain(raw.replace(/^dropped:?\s*/i, ''))
  } else if (/^done\b/i.test(raw)) {
    s.state = 'done'
    const detail = plain(raw.replace(/^done:?\s*/i, ''))
    const m = detail.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?(?:\s*,\s*([0-9a-f]{6,40}))?(?:\s*-\s*(.*))?$/i)
    if (m) { s.date = m[1]; s.time = m[2] ?? null; s.commit = m[3] ?? null; s.note = m[4] ?? null } else { s.note = detail }
  }
  return s
}

export function parse (md) {
  const lines = md.split('\n').map(l => l.replace(/\r$/, ''))
  const items = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEADING)
    if (h) {
      if (cur) cur.end = i
      cur = { id: h[1], lane: h[1].replace(/\d+$/, ''), title: plain(h[2]), state: 'open', owner: null, date: null,
        time: null, reason: null, commit: null, note: null, type: null, prio: null, gate: null, plain: null,
        impact: null, worth: null, progress: null, percent: null, doing: null, progressAt: null, tickets: [], weight: null,
        playableStage: false, hasStatus: false, needs: [], agents: null, proof: null, eta: null, notes: [], raw: null,
        created: null, createdBy: null, model: null, result: null, before: null, after: null, evidence: null,
        unblock: null, related: [], topics: [], blockedAt: null, reviewed: null,
        statusLine: -1, plainLine: -1, start: i, end: lines.length }
      items.push(cur)
      continue
    }
    if (!cur) continue
    if (SECTION.test(lines[i])) { cur.end = i; cur = null; continue }
    const f = lines[i].match(FIELD)
    if (f) {
      const key = f[1].toLowerCase()
      const v = plain(f[2])
      if (key === 'status') { Object.assign(cur, parseStatus(f[2])); cur.raw = v; cur.hasStatus = true; cur.statusLine = i }
      else if (key === 'type') cur.type = v
      else if (key === 'prio' || key === 'priority') cur.prio = v
      else if (key === 'gate') cur.gate = v
      else if (key === 'plain') { cur.plain = v; cur.plainLine = i }
      else if (key === 'needs') cur.needs = ids(v)
      else if (key === 'proof') cur.proof = v.replace(/^`|`$/g, '') || null
      else if (key === 'eta') cur.eta = v || null
      else if (key === 'related') cur.related = ids(v)
      else if (key === 'topics') cur.topics = v.toLowerCase().split(/[\s,]+/).filter(Boolean)
      else if (['created', 'model', 'result', 'before', 'after', 'evidence', 'unblock', 'reviewed'].includes(key)) cur[key] = v || null
      else if (key === 'createdby') cur.createdBy = v || null
      else if (key === 'blockedat') cur.blockedAt = v || null
      else if (key === 'agents') cur.agents = v.split(/[\s,]+/).map(a => a.toLowerCase()).filter(Boolean)
      else if (key === 'impact') cur.impact = v
      else if (key === 'worth') cur.worth = v
      else if (key === 'tickets') cur.tickets = ids(v)
      else if (key === 'weight') { const n = Number(v.replace(/%$/, '')); cur.weight = Number.isFinite(n) ? n : null }
      else if (key === 'playable') cur.playableStage = /^(yes|true|1)$/i.test(v)
      else if (key === 'progress') {
        cur.progress = v
        const m = v.match(/^(\d{1,3})\s*%\s*-?\s*(.*)$/)
        cur.percent = m ? Math.min(100, Number(m[1])) : null
        cur.doing = m ? (m[2].trim() || null) : (v || null)
      }
      else if (key === 'progressat') cur.progressAt = v || null
      continue
    }
    const b = lines[i].match(BULLET)
    if (b) cur.notes.push(plain(b[1]))
  }
  return items
}

export const isStage = it => it.lane === 'S'

// Ticket counts for the header. Stages are not tickets; the user's queue counts once (as `user`).
export function summarise (items) {
  const s = { total: 0, open: 0, claimed: 0, blocked: 0, done: 0, dropped: 0, user: 0 }
  for (const it of items) {
    if (isStage(it)) continue
    s.total++
    if (it.lane === 'U' && it.state !== 'done' && it.state !== 'dropped') { s.user++; continue }
    if (Object.hasOwn(s, it.state)) s[it.state]++
    else s.open++
  }
  return s
}

// Which claimed worktree name appears in `git worktree list --porcelain` (best effort; null = not found).
export function claimWorktree (owner, porcelain) {
  if (!owner || !porcelain) return null
  const tokens = owner.match(/[a-z0-9][a-z0-9._/-]*[a-z0-9]/gi) ?? []
  return tokens.find(t => t.length >= 5 && t.includes('-') && porcelain.includes(t)) ?? null
}

// What other checkouts (git worktrees) say about this ledger: claimed/blocked/done work not merged into main yet,
// plus items that only exist on a branch. `sources`: [{ name, branch, md }] - md null for missing/unreadable.
export function elsewhereClaims (mainItems, sources) {
  const byId = new Map(mainItems.map(i => [i.id, i]))
  const claims = new Map()
  const ghosts = []
  for (const src of sources) {
    if (!src?.md) continue
    let items
    try { items = src.items ?? parse(src.md) } catch { continue }
    const lines = src.md.split('\n')
    for (const it of items) {
      if (isStage(it)) continue
      if (it.state !== 'claimed' && it.state !== 'blocked' && it.state !== 'done') continue
      const main = byId.get(it.id)
      if (main) {
        if (main.state === 'open') {
          claims.set(it.id, { state: it.state, owner: it.owner, date: it.date, time: it.time, commit: it.commit,
            note: it.note, reason: it.reason, progress: it.progress, percent: it.percent, doing: it.doing,
            progressAt: it.progressAt,
            created: it.created, createdBy: it.createdBy, model: it.model, result: it.result, before: it.before,
            after: it.after, evidence: it.evidence, unblock: it.unblock, related: it.related, topics: it.topics,
            blockedAt: it.blockedAt, reviewed: it.reviewed,
            worktree: src.name, branch: src.branch ?? null })
        }
      } else {
        ghosts.push({ ...it, raw: lines.slice(it.start, it.end).join('\n'), worktree: src.name, branch: src.branch ?? null })
      }
    }
  }
  return { claims, ghosts }
}

// Date (ms) of the newest dated note, or null. Notes look like "2026-10-17 20:54 who: text" or "2026-10-17: text".
export function lastNoteAt (notes) {
  let best = null
  for (const n of notes ?? []) {
    const m = String(n).match(/^(\d{4}-\d{2}-\d{2})(?:[ ,]+(\d{2}:\d{2}))?/)
    if (!m) continue
    const ms = Date.parse(`${m[1]}T${m[2] ?? '00:00'}:00`)
    if (!Number.isNaN(ms) && (best === null || ms > best)) best = ms
  }
  return best
}

// Timeline: one entry per stage, computed from the (board-enriched) ticket items: { state, at, percent, notes }.
// Percent = (done tickets + claimed tickets' own % / 100) / tickets that count (dropped ones do not).
// Overall = sum(weight * percent) / sum(weight). Nothing here invents a future date.
export function timeline (items) {
  const tickets = new Map(items.filter(i => !isStage(i)).map(i => [i.id, i]))
  const stageItems = items.filter(isStage)
  const stages = stageItems.map(st => {
    const members = st.tickets.map(id => tickets.get(id) ?? { id, missing: true, state: 'open' })
    const counted = members.filter(t => t.state !== 'dropped')
    let score = 0
    for (const t of counted) {
      if (t.state === 'done') score += 1
      else if (t.state === 'claimed') score += (t.percent ?? 0) / 100
    }
    const explicitDone = st.hasStatus && st.state === 'done'
    let percent = counted.length ? Math.round((score / counted.length) * 100) : (explicitDone ? 100 : 0)
    const allDone = counted.length > 0 && counted.every(t => t.state === 'done')
    const state = explicitDone || allDone ? 'done' : (counted.some(t => t.state === 'done' || t.state === 'claimed') ? 'active' : 'next')
    if (state === 'done') percent = 100
    const ats = counted.map(t => t.at).filter(Boolean)
    const startedAt = ats.length ? Math.min(...ats) : (st.date ? Date.parse(`${st.date}T${st.time ?? '00:00'}:00`) : null)
    const doneAts = counted.filter(t => t.state === 'done').map(t => t.at).filter(Boolean)
    const finishedAt = state !== 'done' ? null
      : (doneAts.length ? Math.max(...doneAts) : (st.date ? Date.parse(`${st.date}T${st.time ?? '00:00'}:00`) : null))
    return {
      id: st.id, title: st.title, plain: st.plain, weight: st.weight ?? 0, playableStage: st.playableStage,
      state, percent, startedAt, finishedAt,
      waitingOnYou: members.filter(t => t.lane === 'U' && t.state !== 'done' && t.state !== 'dropped').length,
      tickets: members.map(t => ({ id: t.id, state: t.state, lane: t.lane ?? t.id.replace(/\d+$/, ''), title: t.title ?? null,
        plain: t.plain ?? null, percent: t.percent ?? null, missing: Boolean(t.missing) })),
    }
  })
  const totalWeight = stages.reduce((a, s) => a + s.weight, 0)
  const overall = totalWeight ? Math.round(stages.reduce((a, s) => a + s.weight * s.percent, 0) / totalWeight) : null
  const here = stages.find(s => s.state !== 'done')?.id ?? null
  const ps = stages.find(s => s.playableStage) ?? null
  const playable = ps ? {
    yes: ps.state === 'done',
    stage: ps.id,
    missing: ps.tickets.filter(t => t.state !== 'done' && t.state !== 'dropped').map(t => ({ id: t.id, plain: t.plain ?? t.title, state: t.state })),
  } : null
  const placed = new Set(stages.flatMap(s => s.tickets.map(t => t.id)))
  const unplaced = [...tickets.values()].filter(t => !placed.has(t.id) && t.state !== 'dropped').map(t => t.id)
  return { stages, overall, here, playable, totalWeight, unplaced }
}

// "What happened when": done tickets (finish time) and dated notes, newest first, grouped by local day.
export function history (items, { limit = 80 } = {}) {
  const events = []
  for (const it of items) {
    if (isStage(it)) continue
    if (it.state === 'done' && it.at) events.push({ at: it.at, id: it.id, lane: it.lane, kind: 'done', text: it.result ?? it.plain ?? it.title, timed: Boolean(it.time) })
    for (const n of it.notes ?? []) {
      const m = String(n).match(/^(\d{4}-\d{2}-\d{2})(?:[ ,]+(\d{2}:\d{2}))?\s*:?\s*([\s\S]*)$/)
      if (!m) continue
      const at = Date.parse(`${m[1]}T${m[2] ?? '00:00'}:00`)
      if (Number.isNaN(at)) continue
      events.push({ at, id: it.id, lane: it.lane, kind: 'note', text: m[3], timed: Boolean(m[2]) })
    }
  }
  events.sort((a, b) => b.at - a.at)
  return events.slice(0, limit)
}
