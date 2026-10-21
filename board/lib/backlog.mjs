// The one ledger writer for every VN port (`npm run issue` in any game runs ../board/issue.mjs on that game's
// docs/BACKLOG.md). Reading goes through ledger.mjs parse(); every edit is line surgery on the touched item, so the
// rest of the file is never rewritten. Writes are always LF (the board's regexes once read CRLF items as open).
// Games re-export this module from their own scripts/lib/backlog.mjs, so their scripts and tests keep one import.
import { claimWorktree, elsewhereClaims, isStage, parse, summarise, timeline } from './ledger.mjs'

export { claimWorktree, elsewhereClaims, parse, summarise }

const SECTION = /^#{2,3}\s/
const HEADING = /^### \[([A-Z]{1,2}\d+)\]\s+(.+?)\s*$/

export const toLF = md => md.replace(/\r\n?/g, '\n')

export function localDate () {
  return new Intl.DateTimeFormat('sv-SE').format(new Date())
}

export function localDateTime () {
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date())
}

export function daysSince (date) {
  if (!date) return null
  const then = Date.parse(`${date}T00:00:00`)
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}

export function byId (items, id) {
  return items.find(i => i.id === String(id ?? '').toUpperCase()) ?? null
}

export function nextId (items, lane) {
  const l = String(lane ?? '').toUpperCase()
  const nums = items.filter(i => i.lane === l).map(i => Number(i.id.slice(l.length))).filter(Number.isFinite)
  return l + (nums.length ? Math.max(...nums) + 1 : 1)
}

export function canClaim (item) {
  if (!item) return { ok: false, why: 'no such item' }
  if (item.state === 'open' || item.state === 'dropped') return { ok: true, why: null }
  if (item.state === 'claimed') return { ok: false, why: `already CLAIMED by ${item.owner ?? 'someone'}` }
  return { ok: false, why: `already ${item.state.toUpperCase()}` }
}

const itemOrThrow = (md, id) => {
  const item = byId(parse(md), id)
  if (!item) throw new Error(`no item ${id} in the ledger`)
  return item
}

export function insertItem (md, { lane, title, type, gate, plain: plainText, prio, impact, worth, needs, proof, by, created = new Date().toISOString() }) {
  const l = String(lane ?? '').toUpperCase()
  if (!l || !title) throw new Error('lane and title are required')
  const lines = toLF(md).split('\n')
  const laneRe = new RegExp(`^#{2,3}\\s*Lane\\s+${l}\\b`)
  const head = lines.findIndex(line => laneRe.test(line))
  if (head < 0) throw new Error(`no "Lane ${l}" section in the ledger`)
  let stop = lines.length
  for (let i = head + 1; i < lines.length; i++) {
    if (SECTION.test(lines[i]) && !HEADING.test(lines[i])) { stop = i; break }
  }
  const id = nextId(parse(md), l)
  const block = [`### [${id}] ${title}`]
  if (plainText) block.push(`Plain: ${plainText}`)
  block.push('Status: OPEN')
  if (type) block.push(`Type: ${type}`)
  if (prio) block.push(`Prio: ${prio}`)
  if (impact) block.push(`Impact: ${impact}`)
  if (worth) block.push(`Worth: ${worth}`)
  if (needs?.length) block.push(`Needs: ${needs.join(', ')}`)
  if (gate) block.push(`Gate: ${gate}`)
  if (proof) block.push(`Proof: ${proof}`)
  // Keep legacy field prefixes intact; game-local format checkers depend on them.
  block.push(`Created: ${created}`)
  if (by) block.push(`CreatedBy: ${by}`)
  const before = lines.slice(0, stop)
  while (before.length && before[before.length - 1].trim() === '') before.pop()
  return { md: [...before, '', ...block, '', ...lines.slice(stop)].join('\n'), id }
}

export function setStatus (md, id, status) {
  const item = itemOrThrow(md, id)
  const lines = toLF(md).split('\n')
  if (item.statusLine >= 0) lines[item.statusLine] = `Status: ${status}`
  else lines.splice(item.start + 1, 0, `Status: ${status}`)
  return lines.join('\n')
}

export function setPlain (md, id, text) {
  const item = itemOrThrow(md, id)
  const lines = toLF(md).split('\n')
  const line = `Plain: ${text}`
  if (item.plainLine >= 0) lines[item.plainLine] = line
  else lines.splice(item.start + 1, 0, line)
  return lines.join('\n')
}

// Upsert `Key: value` fields inside an item (after Status when new); an empty value removes the line.
export function setFields (md, id, fields) {
  let text = toLF(md)
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue
    const item = itemOrThrow(text, id)
    const lines = text.split('\n')
    const re = new RegExp(`^\\**${key}\\**:`, 'i')
    const at = lines.findIndex((l, i) => i > item.start && i < item.end && re.test(l))
    if (value === '') { if (at >= 0) lines.splice(at, 1) }
    else if (at >= 0) lines[at] = `${key}: ${value}`
    else lines.splice(item.statusLine >= 0 ? item.statusLine + 1 : item.start + 1, 0, `${key}: ${value}`)
    text = lines.join('\n')
  }
  return text
}

export function setRating (md, id, { prio, impact, worth } = {}) {
  return setFields(md, id, { Prio: prio || undefined, Impact: impact || undefined, Worth: worth || undefined })
}

export function setNeeds (md, id, needs) {
  return setFields(md, id, { Needs: (needs ?? []).map(n => String(n).toUpperCase()).join(', ') })
}

// Proof commands run through the shell (npm is npm.cmd on Windows), so only `npm run <script> [plain args]` or
// `npm test` is accepted - no shell operators, quotes or variables. Returns null (ok) or the reason.
export function proofProblem (cmd) {
  const c = String(cmd ?? '').trim()
  if (!/^npm (?:test|run [\w:.@/-]+)(?: [\w:.@/=,+-]+)*$/.test(c)) return 'a Proof must be `npm run <script> [plain args]` or `npm test` (no shell operators, quotes or variables)'
  return null
}

export function setProgress (md, id, { percent, text: doing, at } = {}) {
  const value = [percent === null || percent === undefined ? '' : `${percent}%`, (doing ?? '').trim()].filter(Boolean).join(' - ')
  if (!value) throw new Error('setProgress needs a percent and/or a text')
  let next = md
  if (at !== undefined && at !== null && at !== '') next = setFields(next, id, { ProgressAt: at })
  next = setFields(next, id, { Progress: value })
  return next
}

export function appendNote (md, id, text) {
  const item = itemOrThrow(md, id)
  const lines = toLF(md).split('\n')
  const hasNotes = lines.slice(item.start, item.end).some(line => /^\**notes\**:\s*$/i.test(line))
  let at = item.end
  while (at > item.start + 1 && lines[at - 1].trim() === '') at--
  const blankAfter = at >= lines.length || lines[at].trim() !== ''
  const block = hasNotes ? [`- ${text}`] : ['Notes:', `- ${text}`]
  if (blankAfter) block.push('')
  return [...lines.slice(0, at), ...block, ...lines.slice(at)].join('\n')
}

// "claude", "Codex (gpt-6.1-sol) wt-e8" or "OpenCode round7" -> claude / codex / opencode.
export const agentKey = by => String(by ?? '').trim().split(/[\s(,]+/)[0].toLowerCase() || null

// Who may take an item: the item's own `Agents:` line wins; otherwise the project's `agents` rule for that agent
// ({ lanes?: [...], types?: [...] } - an allowlist each), otherwise anyone. Returns null (allowed) or the reason.
export function agentBlock (item, agent, rules = {}) {
  if (!agent) return null
  if (item.agents?.length) {
    return item.agents.includes(agent) || item.agents.includes('any') ? null : `only for ${item.agents.join('/')}`
  }
  const r = rules[agent]
  if (!r) return null
  if (r.lanes && !r.lanes.includes(item.lane)) return `${agent} does not take lane ${item.lane} (projects.json agents)`
  if (r.types && !r.types.includes(String(item.type ?? '').toLowerCase())) {
    return `${agent} only takes Type ${r.types.join('/')} (this is ${item.type ?? 'untyped'})`
  }
  return null
}

const prioRank = p => { const m = String(p ?? '').match(/P([1-3])/i); return m ? Number(m[1]) : 4 }

// Rank what to do next. Candidates are OPEN tickets that are not stages, not the user's (U), not claimed in another
// checkout, whose Needs are all DONE and that the asking agent may take. Order: the stage you are in first
// (timeline order; tickets on no stage last), then Prio P1..P3, then lane order, then number.
// `elsewhere`: Map id -> claim from elsewhereClaims (in-flight in another worktree).
export function rankNext (items, { agent = null, lane = null, rules = {}, laneOrder = [], elsewhere = new Map() } = {}) {
  const byIdMap = new Map(items.map(i => [i.id, i]))
  const tl = timeline(items)
  const stageOf = new Map()
  tl.stages.forEach((s, i) => s.tickets.forEach(t => { if (!stageOf.has(t.id)) stageOf.set(t.id, i) }))
  const ready = [], skipped = []
  for (const it of items) {
    if (isStage(it) || it.state === 'done' || it.state === 'dropped') continue
    if (lane && it.lane !== lane.toUpperCase()) continue
    let why = null
    if (it.lane === 'U') why = "the user's queue - agents never start these"
    else if (it.state === 'claimed') why = `claimed by ${it.owner ?? 'someone'}`
    else if (it.state === 'blocked') why = `blocked: ${it.reason ?? ''}`
    else if (elsewhere.has(it.id)) { const c = elsewhere.get(it.id); why = `${c.state} in worktree ${c.worktree}` }
    if (!why) {
      const waiting = it.needs.filter(n => byIdMap.get(n)?.state !== 'done' && byIdMap.get(n)?.state !== 'dropped')
      if (waiting.length) why = `needs ${waiting.join(', ')} first`
    }
    if (!why) why = agentBlock(it, agent, rules)
    if (why) { skipped.push({ item: it, why }); continue }
    ready.push(it)
  }
  const laneIdx = l => { const i = laneOrder.indexOf(l); return i < 0 ? 99 : i }
  const num = it => Number(it.id.slice(it.lane.length))
  ready.sort((a, b) => (stageOf.get(a.id) ?? 999) - (stageOf.get(b.id) ?? 999) || prioRank(a.prio) - prioRank(b.prio) ||
    laneIdx(a.lane) - laneIdx(b.lane) || num(a) - num(b))
  return { ready, skipped, stageOf, timeline: tl }
}

// Which ready tickets can run at the same time: one writer per folder, and each lane is its own folder, so a combo
// takes at most one ticket per lane - the lane's earliest in board order. When a size needs more seats than lanes
// have ready work, the next tickets come from a lane already in the combo and land in the same folder, so each needs
// its own checkout (git worktree + branch), flagged in `needsWorktree`. `ready` must be in board order (rankNext
// output); `sizes` are the agent budgets to report (2-4 sessions is this machine's budget). A size that cannot add a
// ticket is dropped, and `moreByLane` lists the ready work left behind per lane, in board order.
export function suggestCombos (ready, { sizes = [2, 3, 4] } = {}) {
  const firstPerLane = []
  const seen = new Set()
  for (const it of ready) {
    if (seen.has(it.lane)) continue
    seen.add(it.lane)
    firstPerLane.push(it)
  }
  const combos = []
  for (const size of sizes) {
    const picked = firstPerLane.slice(0, size)
    const taken = new Set(picked.map(i => i.id))
    for (const it of ready) {
      if (picked.length >= size) break
      if (taken.has(it.id)) continue
      picked.push(it)
      taken.add(it.id)
    }
    const ids = picked.map(i => i.id)
    if (ids.length < 2 || combos.some(c => c.ids.join() === ids.join())) continue
    const lanes = new Set()
    const needsWorktree = []
    for (const it of picked) { if (lanes.has(it.lane)) needsWorktree.push(it.id); else lanes.add(it.lane) }
    combos.push({ size, ids, needsWorktree })
  }
  const moreByLane = []
  for (const it of ready) {
    if (firstPerLane.includes(it)) continue
    const group = moreByLane.find(g => g.lane === it.lane)
    if (group) group.ids.push(it.id)
    else moreByLane.push({ lane: it.lane, ids: [it.id] })
  }
  return { combos, moreByLane }
}

// Best order to run the work, top to bottom: finish claimed tickets first (closest to done first),
// then start ready tickets in board order, then queue tickets those steps unblock. Blocked tickets,
// the user's queue and finished work never appear. Each step says why, in plain words.
export function suggestOrder (items, { laneOrder = [], elsewhere = new Map(), rules = {}, agent = null } = {}) {
  const byId = new Map(items.map(i => [i.id, i]))
  const met = id => { const s = byId.get(id)?.state; return s === 'done' || s === 'dropped' }
  const { ready, stageOf, timeline: tl } = rankNext(items, { agent, rules, laneOrder, elsewhere })
  const stageName = id => { const i = stageOf.get(id); return i === undefined ? 'no stage' : tl.stages[i].id }
  const unblocks = id => items
    .filter(x => !isStage(x) && x.state === 'open' && x.lane !== 'U' && !elsewhere.has(x.id) &&
      x.needs.includes(id) && x.needs.every(n => n === id || met(n)))
    .map(x => x.id)
  const steps = []
  const seen = new Set()
  const finishers = []
  for (const it of items) {
    if (isStage(it) || it.lane === 'U' || it.state !== 'claimed') continue
    finishers.push({ id: it.id, percent: it.percent ?? 0, prio: it.prio ?? null, where: 'in progress' })
  }
  for (const [id, c] of elsewhere) {
    if (c.state !== 'claimed' || byId.get(id)?.lane === 'U') continue
    finishers.push({ id, percent: c.percent ?? 0, prio: byId.get(id)?.prio ?? null, where: `in progress in ${c.worktree}` })
  }
  finishers.sort((a, b) => (b.percent - a.percent) || prioRank(a.prio) - prioRank(b.prio) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const f of finishers) {
    const open = unblocks(f.id)
    seen.add(f.id)
    steps.push({ id: f.id, action: 'finish', why: `${f.where} at ${f.percent}%${open.length ? `; finishing it opens ${open.join(', ')}` : ''} (stage ${stageName(f.id)})` })
  }
  for (const it of ready) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    steps.push({ id: it.id, action: 'start', why: `ready now (stage ${stageName(it.id)}${it.prio ? `, ${it.prio}` : ''})` })
  }
  let grew = true
  while (grew) {
    grew = false
    for (const it of items) {
      if (isStage(it) || seen.has(it.id) || it.state !== 'open' || it.lane === 'U' || !it.needs.length) continue
      if (!it.needs.some(n => seen.has(n)) || !it.needs.every(n => met(n) || seen.has(n))) continue
      seen.add(it.id)
      steps.push({ id: it.id, action: 'queue', why: `starts after ${it.needs.filter(n => seen.has(n)).join(', ')} (stage ${stageName(it.id)})` })
      grew = true
    }
  }
  return steps
}
