// Ledger audit: what in docs/BACKLOG.md needs attention after tickets change. Report only - it never writes, so it
// cannot collide with claims in other worktrees; the agent in the loop applies the `suggest` commands it agrees with.
// Used by `npm run issue -- audit` and by the board's "Needs attention" box.
//   level 'fix'   - the ledger is wrong or something is ready to move (apply the suggestion)
//   level 'check' - a ripple to look at: something it depends on changed, or a claim went quiet
//   level 'info'  - tidy-ups
import { isStage, lastNoteAt, timeline } from './ledger.mjs'

const STALE_HOURS = 2
const RECENT_HOURS = 24
const at = (date, time) => (date ? Date.parse(`${date}T${time ?? '00:00'}:00`) : null)
const ID_RE = /\b([A-Z]{1,2}\d+)\b/g
// Prose that names a dependency the `Needs:` line does not carry yet.
const PROSE_DEP = /\b(?:after|needs|blocked by|depends on|follows|once|waits? (?:on|for)|only after)\s+([A-Z]{1,2}\d+)\b/g
// Words that mean the ticket is parked on a background job, a machine slot, or another ticket.
const WAIT_RE = /\b(waiting|waits?|queued?|queue|holding|paused?|background|machine|checkpoint)\b/i

export function audit (items, { md = '', now = Date.now(), elsewhere = new Map(), ghosts = [], porcelain = '',
  staleHours = STALE_HOURS, recentHours = RECENT_HOURS } = {}) {
  const out = []
  const add = (level, code, id, text, suggest = null) => out.push({ level, code, id, text, suggest })
  const tickets = items.filter(i => !isStage(i))
  const byId = new Map(tickets.map(i => [i.id, i]))
  const done = id => byId.get(id)?.state === 'done'
  const live = it => it.state !== 'done' && it.state !== 'dropped'

  // Dependencies.
  for (const it of tickets) {
    for (const n of it.needs) {
      if (n === it.id) add('fix', 'needs-self', it.id, `${it.id} needs itself`, `npm run issue -- needs ${it.id} ${it.needs.filter(x => x !== n).join(',') || '-'}`)
      else if (!byId.has(n)) add('fix', 'needs-missing', it.id, `${it.id} needs ${n}, which is not in the ledger`)
      else if (byId.get(n).state === 'dropped' && live(it)) add('check', 'needs-dropped', it.id, `${it.id} needs ${n}, which was dropped - is ${it.id} still right?`)
    }
    if (it.state === 'blocked') {
      if (!it.unblock) add('info', 'no-recovery', it.id, `${it.id} needs a plain recovery plan: what evidence or change would allow a retry`, `npm run issue -- recovery ${it.id} --unblock "<missing evidence or change>"`)
      const reviewed = Date.parse(it.reviewed ?? it.blockedAt ?? '')
      if (Number.isFinite(reviewed) && now - reviewed > 7 * 86400_000) add('check', 'stale-block', it.id, `${it.id} has not been reviewed for a week; read related work and shared lessons before retrying`, `npm run issue -- rescue ${it.id}`)
      const named = [...new Set([...(it.reason ?? '').matchAll(ID_RE)].map(m => m[1]).filter(x => byId.has(x) && x !== it.id))]
      const deps = [...new Set([...it.needs, ...named])]
      if (deps.length && deps.every(done)) {
        add('fix', 'unblocked', it.id, `${it.id} is BLOCKED but ${deps.join(', ')} ${deps.length > 1 ? 'are' : 'is'} done now`, `npm run issue -- reopen ${it.id}`)
      }
    }
    if (live(it)) {
      const prose = [...new Set([...[it.title, it.gate ?? '', ...(it.notes ?? [])].join('\n').matchAll(PROSE_DEP)].map(m => m[1]))]
        .filter(x => x !== it.id && byId.has(x) && !it.needs.includes(x) && !isStage({ lane: x.replace(/\d+$/, '') }))
      if (prose.length) add('info', 'prose-dep', it.id, `${it.id} mentions ${prose.join(', ')} as a dependency in prose`, `npm run issue -- needs ${it.id} ${[...it.needs, ...prose].join(',')}`)
    }
  }
  // Cycles (each reported once, from its smallest id).
  const seen = new Set()
  for (const it of tickets) {
    const path = []
    const walk = id => {
      if (path.includes(id)) {
        const cyc = path.slice(path.indexOf(id))
        const key = [...cyc].sort().join(',')
        if (!seen.has(key)) { seen.add(key); add('fix', 'needs-cycle', cyc[0], `dependency loop: ${[...cyc, id].join(' -> ')}`) }
        return
      }
      path.push(id)
      for (const n of byId.get(id)?.needs ?? []) walk(n)
      path.pop()
    }
    walk(it.id)
  }

  // Ripples: tickets finished recently -> who depends on them and who shares their stage.
  // Stage mates are grouped: one finding per stage (not one per finished ticket) so a busy
  // stage does not repeat the same still-open list once per done card.
  const tl = timeline(items)
  const stageOf = new Map()
  for (const s of tl.stages) for (const t of s.tickets) if (!stageOf.has(t.id)) stageOf.set(t.id, s)
  const stageMates = new Map()
  for (const it of tickets) {
    if (it.state !== 'done') continue
    const t = at(it.date, it.time)
    if (!t || now - t > recentHours * 3600_000) continue
    const dependents = tickets.filter(x => live(x) && x.needs.includes(it.id))
    const ready = dependents.filter(x => x.needs.every(done)).map(x => x.id)
    const still = dependents.filter(x => !x.needs.every(done)).map(x => x.id)
    const stage = stageOf.get(it.id)
    const mates = stage ? stage.tickets.filter(x => x.id !== it.id && x.state !== 'done' && x.state !== 'dropped' && !dependents.some(d => d.id === x.id)).map(x => x.id) : []
    if (ready.length) add('check', 'ripple-ready', it.id, `${it.id} done -> now ready: ${ready.join(', ')} (re-read their Gate against what ${it.id} found)`)
    if (still.length) add('info', 'ripple-waiting', it.id, `${it.id} done -> ${still.join(', ')} still wait on other tickets`)
    if (mates.length && stage) {
      const g = stageMates.get(stage.id) ?? { stage, doneIds: [], mates: new Set() }
      g.doneIds.push(it.id)
      for (const m of mates) g.mates.add(m)
      stageMates.set(stage.id, g)
    }
  }
  for (const [sid, g] of stageMates) {
    add('check', 'ripple-stage', sid, `stage ${sid} still open after ${g.doneIds.join(', ')} done: ${[...g.mates].join(', ')} (still accurate? re-rate, drop or split)`)
  }

  // Claims.
  for (const it of tickets) {
    if (it.state !== 'claimed') continue
    const progAt = Date.parse(it.progressAt ?? '')
    const last = Math.max(at(it.date, it.time) ?? 0, lastNoteAt(it.notes) ?? 0, Number.isFinite(progAt) ? progAt : 0)
    const waiting = it.needs.filter(n => byId.has(n) && !done(n) && byId.get(n).state !== 'dropped')
    if (waiting.length) {
      add('fix', 'needs-unmet', it.id, `${it.id} is CLAIMED but needs ${waiting.join(', ')} first - finish them or reopen it`, `npm run issue -- reopen ${it.id}`)
    }
    if (last && now - last > staleHours * 3600_000) {
      const h = Math.floor((now - last) / 3600_000)
      add('check', 'stale-claim', it.id, `${it.id} claimed by ${it.owner ?? '?'} with no update for ${h} h`, `npm run issue -- progress ${it.id} --percent N "what is happening"  (or reopen ${it.id} if that agent is gone)`)
    }
    const waitText = [it.doing, it.progress].filter(Boolean).join(' ')
    if (WAIT_RE.test(waitText) && !it.eta) {
      add('check', 'wait-no-eta', it.id, `${it.id} is waiting but shows no time left`, `npm run issue -- eta ${it.id} "<time left>" and npm run issue -- progress ${it.id} --percent N "waiting on <what>, back by <when>"`)
    } else if (WAIT_RE.test(waitText) && last && now - last > 3600_000) {
      add('check', 'wait-stale-eta', it.id, `${it.id} is waiting but its update is over an hour old`, `npm run issue -- eta ${it.id} "<fresh time left>" and npm run issue -- progress ${it.id} --percent N "waiting on <what>, back by <when>"`)
    }
  }
  for (const [id, c] of elsewhere) {
    if (c.state === 'done') add('check', 'done-elsewhere', id, `${id} is DONE in worktree ${c.worktree} but not merged here`)
  }
  for (const g of ghosts) add('info', 'ghost', g.id, `${g.id} exists only in worktree ${g.worktree} (${g.state})`)

  // Timeline shape.
  if (tl.stages.length) {
    if (tl.totalWeight !== 100) add('fix', 'weights', null, `stage weights sum to ${tl.totalWeight}, not 100`)
    const where = new Map()
    for (const s of tl.stages) {
      for (const t of s.tickets) {
        if (t.missing) add('fix', 'stage-missing', s.id, `stage ${s.id} lists ${t.id}, which is not in the ledger`)
        if (where.has(t.id)) add('fix', 'two-stages', t.id, `${t.id} sits in ${where.get(t.id)} and ${s.id}`)
        else where.set(t.id, s.id)
      }
    }
    for (const id of tl.unplaced) {
      if (byId.get(id)?.lane === 'U') continue
      add('fix', 'unplaced', id, `${id} is on no timeline stage (add it to a stage's Tickets: line in docs/BACKLOG.md)`)
    }
  }

  // Proofs: work judged only by hand, waived proofs, and legacy closures from before gates were enforced.
  // A waiver never expires: once a ticket is DONE without a passing Proof it stays visibly distinguishable.
  const waivedOf = it => it.waiver ?? (/proof\s*(skipped|waived)\s*:?\s*(.*)$/im.test(it.note ?? '') ? `legacy: ${it.note.match(/proof\s*(skipped|waived)\s*:?\s*(.*)$/im)?.[2]?.trim() || 'no reason recorded'}` : null)
  for (const it of tickets) {
    if (it.state === 'claimed' && !it.proof && it.lane !== 'U') add('info', 'no-proof', it.id, `${it.id} is in progress with no Proof command - its Gate is judged by hand`, `npm run issue -- proof ${it.id} "npm run <script>"`)
    if (it.state !== 'done') continue
    const waived = waivedOf(it)
    if (waived) {
      add('check', 'waived-proof', it.id, `${it.id} was closed with a waived Proof (${waived}) - re-run the Proof before building on it`)
    } else if (it.lane !== 'U' && !it.proof) {
      add('check', 'unverified-done', it.id, `${it.id} is DONE with no Proof and no recorded waiver (closed before gates were enforced) - add a Proof and re-run it, or record a waiver`, `npm run issue -- proof ${it.id} "npm run <script>"`)
    }
  }

  // Item hygiene.
  for (const it of tickets) {
    if (!live(it)) continue
    if (!it.plain) add('info', 'no-plain', it.id, `${it.id} has no Plain line`, `npm run issue -- plain ${it.id} "<one simple sentence>"`)
    if (!it.gate && it.lane !== 'U') add('info', 'no-gate', it.id, `${it.id} has no Gate (how do we know it is done?)`)
    if (!it.hasStatus) add('fix', 'no-status', it.id, `${it.id} has no Status line`)
    for (const n of it.notes ?? []) {
      if (/^(\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?)\s+\1\b/.test(n)) { add('info', 'double-date', it.id, `${it.id} has a note with its date twice`); break }
    }
  }
  if (/\r/.test(md)) add('info', 'crlf', null, 'the ledger has CRLF line endings (the next `npm run issue` write makes it LF)')
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(md)) add('fix', 'control-chars', null, 'the ledger holds control characters (a "\\b" in a Windows path becomes a backspace)')

  const order = { fix: 0, check: 1, info: 2 }
  return out.sort((a, b) => order[a.level] - order[b.level])
}
