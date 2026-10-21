import { join } from 'node:path'
import { audit } from './audit.mjs'
import { rankNext, suggestCombos, suggestOrder } from './backlog.mjs'
import { currentStateFindings } from './document-size.mjs'
import { elsewhereClaims, timeline } from './ledger.mjs'
import { parsedLedger } from './ledger-cache.mjs'
import { dirtyCheckout, gitStatus } from './maintainer.mjs'
import { recoveryCards, recoveryFindings } from './recovery.mjs'
import { oracleFindings } from './oracles.mjs'
import { worktrees } from './worktrees.mjs'

const levelRank = { fix: 0, check: 1, info: 2 }

export function loadProjectState (project, { root = project?.root, now = Date.now(), fresh = false, boardStatusCache = false } = {}) {
  const ledgerPath = root ? join(root, 'docs', 'BACKLOG.md') : null
  const ledger = ledgerPath ? parsedLedger(ledgerPath) : { md: null, items: [] }
  const hasLedger = ledger.md !== null
  const items = ledger.items ?? []
  const wt = root && hasLedger ? worktrees(root, { maxAgeMs: fresh ? 0 : 15000, now }) : { at: now, porcelain: '', sources: [], commits: new Map() }
  const { claims, ghosts } = elsewhereClaims(items, wt.sources)
  const statusRaw = root && hasLedger ? gitStatus(root, { maxAgeMs: boardStatusCache ? 15000 : 0, now }).raw : ''
  const dirty = dirtyCheckout(root, { maxAgeMs: boardStatusCache ? 15000 : 0, now, statusRaw })
  const effective = items.map(it => claims.has(it.id) ? { ...it, ...claims.get(it.id) } : it)
  return { project, root, ledgerPath, hasLedger, md: ledger.md ?? '', items, claims, ghosts, effective, worktrees: wt,
    statusRaw, dirty, now }
}

export function projectGoal (state, { laneOrder = Object.keys(state.project?.lanes ?? {}) } = {}) {
  const { ready } = rankNext(state.items, { laneOrder, elsewhere: state.claims })
  const tl = timeline(state.effective)
  const here = tl.stages.find(s => s.id === tl.here) ?? null
  const unmerged = [...state.claims].filter(([, c]) => c.state === 'done').map(([id]) => id)
  const combos = suggestCombos(ready)
  const order = suggestOrder(state.items, { laneOrder, elsewhere: state.claims })
  return { timeline: tl, here, ready, unmerged, combos, order, effective: state.effective,
    playable: tl.playable, overall: tl.overall }
}

export function formatGoal (goal, { handoff = 'HANDOFF.md' } = {}) {
  const lines = []
  const tl = goal.timeline
  if (!tl.stages.length) return `no ## Timeline in docs/BACKLOG.md - the goal is whatever ${handoff} says is next`
  lines.push(`Playable: ${tl.playable ? (tl.playable.yes ? 'yes' : `not yet (needs ${tl.playable.missing.map(m => m.id).join(', ') || '?'})`) : 'unknown'}`)
  lines.push(`Overall: ${tl.overall}% (same as the board${goal.unmerged.length ? `; includes ${goal.unmerged.join(', ')} finished in worktrees not merged yet` : ''})`)
  if (!goal.here) { lines.push('Every stage is done.'); return lines.join('\n') }
  const here = goal.here
  lines.push(`You are here: [${here.id}] ${here.title} - ${here.percent}%`)
  if (here.plain) lines.push(`  ${here.plain}`)
  for (const t of here.tickets) lines.push(`  ${t.id.padEnd(5)} ${t.state.padEnd(8)} ${t.plain ?? t.title ?? ''}`)
  const user = goal.effective.filter(i => i.lane === 'U' && i.state !== 'done' && i.state !== 'dropped')
  if (user.length) lines.push(`Waiting on the user: ${user.map(i => i.id).join(', ')}`)
  lines.push(`Ready to start: ${goal.ready.length ? goal.ready.map(i => i.id).join(', ') : 'nothing'}`)
  if (goal.combos.combos.length) {
    lines.push('Run together (one writer per folder; * = give it its own worktree + branch):')
    for (const c of goal.combos.combos) lines.push(`  ${c.size} agents: ${c.ids.map(id => (c.needsWorktree.includes(id) ? `${id}*` : id)).join(' + ')}`)
  }
  if (goal.combos.moreByLane.length) lines.push(`Also ready, same folder as a pick above (one each, own checkout): ${goal.combos.moreByLane.map(g => `${g.ids.join(' ')} (${g.lane})`).join(' · ')}`)
  if (goal.order.length) {
    lines.push('Best order to run (top to bottom; one writer per folder):')
    goal.order.forEach((s, i) => lines.push(`  ${i + 1}. ${s.action} ${s.id} - ${s.why}`))
  }
  return lines.join('\n')
}

export function completeAudit (state, { project = state.project, messages = [], lessons = [], now = state.now ?? Date.now(), includeOracles = true, oracleFile } = {}) {
  const plans = recoveryCards(state.effective, { messages, lessons, now })
  const findings = [
    ...(includeOracles ? oracleFindings(project, { now, file: oracleFile }) : []),
    ...audit(state.items, { md: state.md, elsewhere: state.claims, ghosts: state.ghosts, now }),
    ...currentStateFindings(project, { root: state.root }),
    ...recoveryFindings(plans),
  ].sort((a, b) => (levelRank[a.level] ?? 99) - (levelRank[b.level] ?? 99))
  return { findings, plans }
}
