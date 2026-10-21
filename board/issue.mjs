#!/usr/bin/env node
// Ticket CLI for every VN port - `npm run issue` in a game (its scripts/backlog.mjs runs this with --project/--root),
// or `node issue.mjs --project sakura ...` here. It edits only the touched item's lines in <root>/docs/BACKLOG.md,
// where <root> is the checkout you run it in (a worktree writes its own ledger). Run bare for the command list.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { audit } from './lib/audit.mjs'
import { agentBlock, agentKey, appendNote, byId, canClaim, claimWorktree, daysSince, elsewhereClaims, insertItem, localDate,
  localDateTime, parse, proofProblem, rankNext, setFields, setNeeds, setPlain, setProgress, setRating, setStatus, summarise, toLF } from './lib/backlog.mjs'
import { fmt as fmtMsg, HEADER as CHANNEL_HEADER, KINDS, post, read as readChannel, setCursor, unread } from './lib/channel.mjs'
import { appendLesson, recentLessons, storyLike } from './lib/knowledge.mjs'
import { recoveryCards } from './lib/recovery.mjs'
import { timeline } from './lib/ledger.mjs'
import { lock as lockOracles } from './lib/oracles.mjs'
import { loadProjects } from './lib/projects.mjs'
import { completeAudit, formatGoal, loadProjectState, projectGoal } from './lib/project-state.mjs'
import { ruleCard } from './lib/rules.mjs'
import { worktrees } from './lib/worktrees.mjs'

const fail = msg => { console.error(`issue: ${msg}`); process.exit(1) }
const str = v => (typeof v === 'string' ? v : undefined)

const argv = process.argv.slice(2)
const positional = []
const flags = {}
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--') continue
  if (a.startsWith('--')) {
    const next = argv[i + 1]
    flags[a.slice(2)] = next !== undefined && !next.startsWith('--') ? argv[++i] : true
  } else positional.push(a)
}
const command = positional.shift() ?? 'list'

// Which checkout: --root, else the nearest folder above the current one that has docs/BACKLOG.md, else the
// --project's main folder (so `node issue.mjs --project sakura goal` works from the board folder).
const projects = loadProjects()
const norm = p => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
function findRoot () {
  if (str(flags.root)) return resolve(str(flags.root))
  let dir = process.cwd()
  for (;;) {
    if (existsSync(join(dir, 'docs', 'BACKLOG.md'))) return dir
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return projects.find(p => p.id === str(flags.project))?.root ?? null
}
const root = findRoot()
const project = (str(flags.project) && projects.find(p => p.id === str(flags.project))) ||
  projects.find(p => p.root && root && norm(p.root) === norm(root)) || null
const NO_LEDGER = new Set(['help', 'say', 'inbox', 'rules', 'channel'])
if (!root && !NO_LEDGER.has(command)) fail('no docs/BACKLOG.md here or above; run it inside a game folder (or pass --root <game folder>)')
const ledgerPath = root ? join(root, 'docs', 'BACKLOG.md') : null
const laneNames = project?.lanes ?? {}
const laneOrder = [...Object.keys(laneNames).filter(l => l !== 'U'), 'U']
const laneHelp = Object.entries(laneNames).map(([k, v]) => `${k} ${v[0]}`).join(', ') || 'see the ledger'
const agentRules = project?.agentRules ?? {}

const read = () => readFileSync(ledgerPath, 'utf8')
const write = md => writeFileSync(ledgerPath, toLF(md))
const git = args => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim() } catch { return '' }
}
const sortItems = list => [...list].sort((a, b) => {
  const la = laneOrder.indexOf(a.lane), lb = laneOrder.indexOf(b.lane)
  return (la < 0 ? 99 : la) - (lb < 0 ? 99 : lb) || Number(a.id.slice(a.lane.length)) - Number(b.id.slice(b.lane.length))
})
const getItem = (md, id, cmd) => {
  if (!id) fail(`${cmd} needs an ID`)
  const item = byId(parse(md), id)
  if (!item) fail(`no item ${String(id).toUpperCase()}`)
  return item
}
const elsewhereNow = items => (root ? elsewhereClaims(items, worktrees(root).sources) : { claims: new Map(), ghosts: [] })

const HELP = `usage: npm run issue [--] <command> [args]          (lanes here: ${laneHelp})
 reading
  (bare) | list [--all] [--lane X] [--state open]   items, then the summary line
  show <ID>                                         one ticket + its Needs/Related one-liners and stage (use this, not the whole file)
  goal                                              where the game stands: playable?, %, the stage you are in
  next [--agent claude|codex|opencode] [--lane X] [--explain] [--json]
                                                    what to work on next (stage, Prio, Needs, agent rules)
  audit [--json]                                    what needs attention after changes (never writes)
  rescue [ID] [--json]                              stuck cards: related work, lessons and messages to review
  rules [--lane X]                                  the rule card (claim prints it too - re-read it every ticket)
 talking to the other agents (information, never orders)
  inbox --by "<agent> [worktree]" [--all]           unread messages for this game + all ports (marks them read)
  say "<text>" --by "<agent>" [--kind ${KINDS.join('|')}] [--ticket E5] [--all-games]
  channel [--limit N]                               the last messages, without marking anything read
 changing
  new "<title>" --lane X [--plain ".."] [--gate ".."] [--type task|bug|perf|verify|grunt|user]
                         [--prio P1|P2|P3] [--impact ".."] [--worth "+N%"] [--needs E1,M2] [--by "<agent/model>"]
  claim <ID> --by "<agent> [worktree]" [--model "<actual model>"] [--force]
  model <ID> "<actual model>"                       record a known model; never infer it from the app name
  progress <ID> [--percent N] "what is happening"   live progress on the In progress card
  eta <ID> "<2-3 h>"                                the agent's own time estimate for the card ("none" clears)
  note <ID> "text" [--by "<who>"]                   dated bullet under the item (do not start the text with a date)
  done <ID> [--note ".."] [--commit <sha>] [--skip-proof "why"]
                                                    runs the Proof first; default commit = HEAD; prints ripples
                         [--before ".."] [--after ".."] [--evidence "checks / measured results"]
  summary <ID> --result "plain outcome" [--before ".."] [--after ".."] [--evidence ".."]
                                                    explain an existing result without changing status
  recovery <ID> --unblock "what would allow a retry" [--related E12,U4] [--topics timing,worker]
  reviewed <ID> "what evidence was checked / why it still waits"  date the review without reopening
  block <ID> --reason ".."                          after 2 failed gate attempts; write the evidence in HANDOFF
  drop <ID> --reason ".."                           no longer worth doing
  reopen <ID>                                       back to OPEN
  plain <ID> "text"                                 the jargon-free sentence the user reads on the board
  rate <ID> [--prio P1|P2|P3] [--impact ".."] [--worth "+N%"]
  needs <ID> E1,M2 | none                           tickets that must be DONE first
  proof <ID> "npm run <script> [args]" | none       the command done runs; it must pass to close the ticket
  prove <ID>                                        run the ticket's Proof now (does not close it)
  oracle-lock --by user                             THE USER ONLY: re-hash the checkers after approving a change
  learn "<lesson>" [--tags a,b] [--by <agent>]      share a lesson with every port (knowledge/LESSONS.md)`

function listCommand () {
  const items = parse(read())
  const s = summarise(items)
  let sel = items.filter(i => i.lane !== 'S' || (str(flags.lane) ?? '').toUpperCase() === 'S')
  if (str(flags.lane)) sel = sel.filter(i => i.lane === str(flags.lane).toUpperCase())
  if (str(flags.state)) sel = sel.filter(i => i.state === str(flags.state).toLowerCase())
  else if (!flags.all) sel = sel.filter(i => i.state !== 'done' && i.state !== 'dropped')
  const porcelain = git(['worktree', 'list', '--porcelain'])
  for (const it of sortItems(sel)) {
    const extra = []
    if (it.state === 'claimed' && it.owner) {
      extra.push(it.owner)
      const d = daysSince(it.date)
      if (d !== null) extra.push(`${d}d`)
      if (claimWorktree(it.owner, porcelain)) extra.push('worktree alive')
    }
    if (it.state === 'blocked') extra.push(it.reason ?? '')
    if (it.state === 'done') extra.push([it.date, it.commit].filter(Boolean).join(' '))
    if (it.needs.length && it.state !== 'done') extra.push(`needs ${it.needs.join(',')}`)
    console.log(`${it.id.padEnd(5)} ${it.state.padEnd(8)} ${it.title}${extra.length ? `  ${extra.join(' · ')}` : ''}`)
  }
  console.log(`\n${s.open} open · ${s.claimed} claimed · ${s.blocked} blocked · ${s.user} waiting on user · ${s.done} done · ${s.total} total`)
  if (!flags.all && (s.done || s.dropped)) console.log('(--all includes done/dropped)')
}

function depLine (it) {
  if (!it) return null
  const bits = [`${it.id} [${it.state.toUpperCase()}] ${it.title}`]
  if (it.state === 'done' && (it.result ?? it.plain)) bits.push(`— ${it.result ?? it.plain}`)
  else if (it.plain) bits.push(`— ${it.plain}`)
  if (it.gate && it.state !== 'done') bits.push(`(Gate: ${it.gate})`)
  return bits.join(' ')
}

function printTicketContext (items, id) {
  const me = byId(items, id)
  if (!me) return
  const tl = timeline(items)
  const stage = tl.stages.find(s => s.tickets.some(t => t.id === id)) ?? null
  const deps = [...me.needs, ...me.related.filter(r => !me.needs.includes(r))]
    .map(d => byId(items, d)).filter(Boolean)
  if (!deps.length && !stage) return
  console.log('')
  if (stage) console.log(`stage: [${stage.id}] ${stage.title} - ${stage.percent}%`)
  for (const d of deps) {
    const tag = me.needs.includes(d.id) ? 'needs' : 'related'
    console.log(`${tag}: ${depLine(d)}`)
  }
  console.log('(full card above; use `issue show <ID>` per card, never read the whole BACKLOG.md)')
}

function showCommand (id) {
  const md = toLF(read())
  const item = getItem(md, id, 'show')
  console.log(md.split('\n').slice(item.start, item.end).join('\n').trimEnd())
  printTicketContext(parse(md), item.id)
}

function goalCommand () {
  const state = loadProjectState(project ?? { id: 'unknown', root }, { root, fresh: true })
  console.log(formatGoal(projectGoal(state, { laneOrder })))
}

function nextCommand () {
  const items = parse(read())
  const agent = agentKey(str(flags.agent) ?? str(flags.by))
  const { claims } = elsewhereNow(items)
  const { ready, skipped, stageOf, timeline: tl } = rankNext(items, { agent, lane: str(flags.lane), rules: agentRules, laneOrder, elsewhere: claims })
  if (flags.json) { console.log(JSON.stringify({ agent, ready: ready.map(i => i.id), skipped: skipped.map(s => ({ id: s.item.id, why: s.why })) }, null, 2)); return }
  const stageName = id => { const i = stageOf.get(id); return i === undefined ? 'no stage' : tl.stages[i].id }
  if (!ready.length) {
    console.log(`nothing ${agent ? `${agent} may ` : ''}start right now${str(flags.lane) ? ` in lane ${str(flags.lane).toUpperCase()}` : ''}.`)
    console.log('-> stop the loop and report: what is blocked, what waits on the user, what needs another agent.')
  } else {
    const [top, ...rest] = ready
    console.log(`next: ${top.id}  ${top.title}`)
    console.log(`  stage ${stageName(top.id)} · ${top.prio ?? 'no prio'} · type ${top.type ?? '-'}${top.needs.length ? ` · needs ${top.needs.join(',')} (done)` : ''}`)
    if (top.plain) console.log(`  plain: ${top.plain}`)
    if (top.gate) console.log(`  done when: ${top.gate}`)
    console.log(`  claim: npm run issue -- claim ${top.id} --by "${agent ?? '<agent>'} <worktree>"`)
    if (rest.length) console.log(`then: ${rest.slice(0, 4).map(i => `${i.id} (${stageName(i.id)} ${i.prio ?? '-'})`).join(', ')}`)
  }
  if (flags.explain) {
    console.log('\nskipped:')
    for (const s of skipped) console.log(`  ${s.item.id.padEnd(5)} ${s.why}`)
  }
}

function printAudit (findings) {
  if (!findings.length) { console.log('audit: nothing needs attention'); return }
  for (const f of findings) {
    console.log(`${f.level.padEnd(5)} ${f.text}`)
    if (f.suggest) console.log(`      suggest: ${f.suggest}`)
  }
  const n = l => findings.filter(f => f.level === l).length
  console.log(`\n${n('fix')} fix · ${n('check')} check · ${n('info')} info   (audit never writes; apply what you agree with)`)
}

function auditCommand () {
  const state = loadProjectState(project ?? { id: 'unknown', root }, { root, fresh: true })
  const messages = channels().flatMap(c => readChannel(c, { limit: 200 })).sort((a, b) => b.at - a.at)
  const { findings } = completeAudit(state, { project, messages, lessons: recentLessons(200), now: Date.now() })
  if (flags.json) console.log(JSON.stringify(findings, null, 2))
  else printAudit(findings)
}

function newCommand () {
  const title = positional.join(' ').trim()
  if (!title) fail('new needs a title: npm run issue -- new "title" --lane X')
  if (!str(flags.lane)) fail(`--lane is required (${laneHelp})`)
  const needs = str(flags.needs) ? str(flags.needs).split(/[\s,]+/).filter(Boolean).map(s => s.toUpperCase()) : []
  if (str(flags.proof) && proofProblem(str(flags.proof))) fail(proofProblem(str(flags.proof)))
  const res = insertItem(read(), { lane: str(flags.lane), title, type: str(flags.type), gate: str(flags.gate), plain: str(flags.plain),
    prio: str(flags.prio), impact: str(flags.impact), worth: str(flags.worth), needs, proof: str(flags.proof), by: str(flags.by) })
  write(res.md)
  console.log(`${res.id}: OPEN - ${title}`)
  if (!str(flags.plain)) console.log(`hint: add the jargon-free sentence the board shows: npm run issue -- plain ${res.id} "one simple sentence"`)
  if (res.id[0] !== 'U') console.log(`hint: put ${res.id} on a timeline stage (its Tickets: line in docs/BACKLOG.md) - npm run issue -- audit checks it`)
}

function claimCommand (id) {
  const by = str(flags.by)
  if (!by) fail('claim needs --by "<agent> [worktree]"')
  const md = read()
  const items = parse(md)
  const item = getItem(md, id, 'claim')
  const ok = canClaim(item)
  if (!ok.ok && !flags.force) fail(`${item.id} ${ok.why} (--force takes it over)`)
  const other = elsewhereNow(items).claims.get(item.id)
  if (other && !flags.force) fail(`${item.id} is ${other.state} in worktree ${other.worktree} (${other.owner ?? '?'}) - pick another (--force takes it over)`)
  if (item.lane === 'U' && !flags.force) fail(`${item.id} is the user's - agents never start U items`)
  const blocked = agentBlock(item, agentKey(by), agentRules)
  if (blocked && !flags.force) fail(`${item.id}: ${blocked} (--force overrides)`)
  const status = `CLAIMED by ${by}, ${localDateTime()}`
  let next = setStatus(md, item.id, status)
  // A fresh claim must not inherit the previous worker's model.
  next = setFields(next, item.id, { Model: str(flags.model) ?? '' })
  write(next)
  if (!str(flags.model)) console.log('model not recorded: add --model "<actual model>" or run issue model; the board will not guess it from Codex/Claude.')
  console.log(`${item.id}: ${status}`)
  console.log('commit this line alone first, then the work.')
  printTicketContext(items, item.id)
  if (!item.proof) console.log(`no Proof yet - add the command that proves the Gate: npm run issue -- proof ${item.id} "npm run <script>"`)
  if (!item.eta) console.log(`no ETA yet - how long will this take? npm run issue -- eta ${item.id} "2-3 h" (refresh it as the work moves; the board shows it)`)
  console.log('')
  console.log(ruleCard(project, { lane: item.lane }))
  const news = unread(channels(), by)
  if (news.length) {
    console.log(`\n${news.length} unread message(s) from other agents - npm run issue -- inbox --by "${by}"  (${CHANNEL_HEADER})`)
    for (const m of news.slice(-3)) console.log(`  ${fmtMsg(m)}`)
  }
}

function noteCommand (id) {
  const text = positional.slice(1).join(' ').trim().replace(/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?:?\s*/, '')
  if (!text) fail('note needs text')
  const md = read()
  const item = getItem(md, id, 'note')
  write(appendNote(md, item.id, `${localDateTime()}${str(flags.by) ? ` ${str(flags.by)}:` : ''} ${text}`))
  console.log(`${item.id}: note added`)
}

// Runs a ticket's Proof in the checkout; true when it exits 0.
function runProof (item) {
  const why = proofProblem(item.proof)
  if (why) fail(`${item.id}: ${why} (fix it: npm run issue -- proof ${item.id} "npm run <script>")`)
  console.log(`proof for ${item.id}: ${item.proof}`)
  const [, ...args] = item.proof.split(' ')
  const r = spawnSync('npm', args, { cwd: root, stdio: 'inherit', shell: true, windowsHide: true })
  const ok = r.status === 0
  console.log(`proof for ${item.id}: ${ok ? 'PASS' : `FAIL (exit ${r.status ?? r.signal})`}`)
  return ok
}

function proveCommand (id) {
  const item = getItem(read(), id, 'prove')
  if (!item.proof) fail(`${item.id} has no Proof: npm run issue -- proof ${item.id} "npm run <script>"`)
  process.exit(runProof(item) ? 0 : 1)
}

function proofCommand (id) {
  const cmd = positional.slice(1).join(' ').trim()
  if (!cmd) fail('proof needs the command: npm run issue -- proof E5 "npm run proof:scene"  (or "none")')
  const md = read()
  const item = getItem(md, id, 'proof')
  if (/^(none|-)$/i.test(cmd)) { write(setFields(md, item.id, { Proof: '' })); console.log(`${item.id}: no Proof`); return }
  const why = proofProblem(cmd)
  if (why) fail(why)
  write(setFields(md, item.id, { Proof: cmd }))
  console.log(`${item.id}: Proof = ${cmd}  (done runs it; it must pass)`)
}

function doneCommand (id) {
  const md0 = read()
  const item0 = getItem(md0, id, 'done')
  let proofNote = ''
  if (item0.proof && !str(flags['skip-proof'])) {
    if (!runProof(item0)) fail(`${item0.id} stays open: its Proof failed. Fix the work (never the checker), or after two failed attempts: npm run issue -- block ${item0.id} --reason "..."`)
    proofNote = `proof passed (${item0.proof})`
  } else if (item0.proof) proofNote = `proof skipped: ${str(flags['skip-proof'])}`
  const md = read()
  const item = getItem(md, id, 'done')
  const commit = str(flags.commit) ?? (git(['rev-parse', '--short', 'HEAD']) || null)
  const noteText = [str(flags.note), proofNote].filter(Boolean).join('; ')
  const status = `DONE ${localDateTime()}${commit ? `, ${commit}` : ''}${noteText ? ` - ${noteText}` : ''}`
  const next = setFields(setStatus(md, item.id, status), item.id, {
    Result: str(flags.result) ?? str(flags.note) ?? item.result ?? item.plain ?? undefined,
    Before: str(flags.before), After: str(flags.after), Evidence: str(flags.evidence),
  })
  write(next)
  console.log(`${item.id}: ${status}`)
  const ripples = audit(parse(next), { md: next }).filter(f => f.id === item.id && /^ripple|^unblocked/.test(f.code) ||
    (f.code === 'ripple-stage' && f.text.includes(item.id)))
  for (const f of ripples) console.log(`ripple: ${f.text}`)
  console.log('next: update the HANDOFF top block, run `npm run issue -- audit`, and `learn` anything another port could use.')
  if (!(str(flags.before) || item.before) || !(str(flags.after) || item.after)) console.log('add a plain Before / After with `issue summary`; include measured checks in Evidence, and say when no before benchmark exists.')
}

function setStateCommand (id, cmd, prefix) {
  const reason = str(flags.reason) ?? (positional.slice(1).join(' ').trim() || null)
  if (!reason) fail(`${cmd} needs --reason "..."`)
  const md = read()
  const item = getItem(md, id, cmd)
  let next = setStatus(md, item.id, `${prefix}: ${reason}`)
  if (cmd === 'block') next = setFields(next, item.id, { BlockedAt: new Date().toISOString(), Reviewed: '',
    Unblock: str(flags.unblock), Related: str(flags.related), Topics: str(flags.topics) })
  write(next)
  console.log(`${item.id}: ${prefix}: ${reason}`)
  if (cmd === 'block') console.log('escalate: write what you tried + evidence into the HANDOFF top block, then move on to `next`.')
}

function plainCommand (id) {
  const text = positional.slice(1).join(' ').trim()
  if (!text) fail('plain needs text: npm run issue -- plain E1 "one sentence the user can read"')
  const md = read()
  const item = getItem(md, id, 'plain')
  write(setPlain(md, item.id, text))
  console.log(`${item.id}: Plain updated`)
}

function rateCommand (id) {
  const md = read()
  const item = getItem(md, id, 'rate')
  let prio = str(flags.prio)
  if (prio && !/^P[123]$/i.test(prio)) fail('--prio must be P1, P2 or P3')
  if (prio) prio = prio.toUpperCase()
  const impact = str(flags.impact)
  const worth = str(flags.worth)
  if (!prio && !impact && !worth) fail('rate needs at least one of --prio P1|P2|P3, --impact "...", --worth "+N%"')
  write(setRating(md, item.id, { prio, impact, worth }))
  console.log(`${item.id}: rated ${[prio && `prio=${prio}`, impact && 'impact set', worth && `worth=${worth}`].filter(Boolean).join(' ')}`)
}

function progressCommand (id) {
  const text = positional.slice(1).join(' ').trim() || null
  let percent = null
  if (flags.percent !== undefined && flags.percent !== true) {
    percent = Number(str(flags.percent))
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) fail('--percent must be a number 0-100')
  }
  if (percent === null && !text) fail('progress needs --percent N and/or a "what is happening" text')
  const md = read()
  const item = getItem(md, id, 'progress')
  write(setProgress(md, item.id, { percent, text, at: new Date().toISOString() }))
  console.log(`${item.id}: progress ${percent === null ? '' : `${percent}% `}${text ?? ''}`.trim())
}

function etaCommand (id) {
  const text = positional.slice(1).join(' ').trim()
  if (!text) fail('eta needs a duration: npm run issue -- eta E1 "2-3 h" (the agent\'s own estimate; "none" clears it)')
  const md = read()
  const item = getItem(md, id, 'eta')
  write(setFields(md, item.id, { Eta: /^(none|-)$/i.test(text) ? '' : text }))
  console.log(`${item.id}: Eta: ${text}`)
}

function needsCommand (id) {
  const raw = positional.slice(1).join(',')
  if (!raw) fail('needs takes ticket IDs (or "none"): npm run issue -- needs E5 E1,M2')
  const list = /^(none|-)$/i.test(raw.trim()) ? [] : raw.split(/[\s,]+/).filter(Boolean).map(s => s.toUpperCase())
  const md = read()
  const items = parse(md)
  const item = getItem(md, id, 'needs')
  const unknown = list.filter(n => !byId(items, n))
  if (unknown.length) fail(`not in the ledger: ${unknown.join(', ')}`)
  if (list.includes(item.id)) fail(`${item.id} cannot need itself`)
  write(setNeeds(md, item.id, list))
  console.log(`${item.id}: ${list.length ? `needs ${list.join(', ')}` : 'no dependencies'}`)
}

function reopenCommand (id) {
  const md = read()
  const item = getItem(md, id, 'reopen')
  write(setStatus(md, item.id, 'OPEN'))
  console.log(`${item.id}: OPEN`)
}

function metadataCommand (id, kind) {
  const md = read()
  const item = getItem(md, id, kind)
  let fields
  if (kind === 'model') {
    const model = positional.slice(1).join(' ').trim()
    if (!model) fail('model needs the actual model name, not the application name')
    fields = { Model: model }
  } else if (kind === 'summary') {
    if (!str(flags.result) && !str(flags.before) && !str(flags.after) && !str(flags.evidence)) fail('summary needs --result, --before, --after or --evidence')
    fields = { Result: str(flags.result), Before: str(flags.before), After: str(flags.after), Evidence: str(flags.evidence) }
  } else {
    if (!str(flags.unblock)) fail('recovery needs --unblock "what evidence or change would allow another attempt"')
    const related = str(flags.related)?.split(/[\s,]+/).filter(Boolean).map(x => x.toUpperCase())
    if (related?.some(id => id === item.id || !byId(parse(md), id))) fail('related must name other existing tickets in this project')
    fields = { Unblock: str(flags.unblock), Related: related?.join(', '), Topics: str(flags.topics) }
  }
  write(setFields(md, item.id, fields))
  console.log(`${item.id}: ${kind} updated (status unchanged)`)
}

function reviewedCommand (id) {
  const text = positional.slice(1).join(' ').trim()
  if (!text) fail('reviewed needs a plain note about the evidence checked')
  const md = read()
  const item = getItem(md, id, 'reviewed')
  write(appendNote(setFields(md, item.id, { Reviewed: new Date().toISOString() }), item.id, `${localDateTime()} Review: ${text}`))
  console.log(`${item.id}: review recorded (status unchanged)`)
}

function rescueCommand () {
  const items0 = parse(read())
  const { claims } = elsewhereNow(items0)
  const items = items0.map(it => claims.has(it.id) ? { ...it, ...claims.get(it.id) } : it)
  const messages = channels().flatMap(c => readChannel(c, { limit: 200 })).sort((a, b) => b.at - a.at)
  const plans = recoveryCards(items, { messages, lessons: recentLessons(200) }).filter(p => !positional[0] || p.id === positional[0].toUpperCase())
  if (flags.json) { console.log(JSON.stringify(plans, null, 2)); return }
  if (!plans.length) { console.log('No matching stuck cards.'); return }
  console.log('Recovery leads only: verify the evidence, preserve the Gate and checkers, then explicitly reopen if justified.')
  for (const p of plans) {
    console.log(`\n${p.id}: ${p.unblock}`)
    for (const signal of p.signals) console.log(`  REVIEW: ${signal}`)
    for (const t of p.related) console.log(`  ${t.id} (${t.state}): ${t.result ?? t.plain}`)
    for (const l of p.lessons) console.log(`  lesson ${l.date} [${l.project}]: ${l.text}`)
    for (const m of p.messages) console.log(`  ${fmtMsg(m)}`)
  }
}

function learnCommand () {
  const text = positional.join(' ').trim()
  if (!text) fail('learn needs the lesson: npm run issue -- learn "what another port should know" --tags engine,wasm')
  const why = storyLike(text)
  if (why) fail(`refused: the lesson contains ${why}. Describe the engineering point, never story text.`)
  const tags = str(flags.tags) ? str(flags.tags).split(/[\s,]+/).filter(Boolean).map(t => t.toLowerCase()) : []
  try {
    const line = appendLesson({ date: localDate(), project: project?.id ?? 'vn-ports', tags, text, by: str(flags.by) ?? null })
    console.log(`learned: ${line}`)
    console.log('the knowledge folder is its own git repo (VN-Ports root): commit it there, not in the game repo.')
  } catch (e) { fail(e.message) }
}

// The channels an agent here reads: this game's and the one for all ports.
function channels () { return [...(project ? [project.id] : []), 'all'] }

function rulesCommand () { console.log(ruleCard(project, { lane: str(flags.lane)?.toUpperCase() ?? null })) }

function sayCommand () {
  const text = positional.join(' ').trim()
  const by = str(flags.by)
  if (!text) fail('say needs the message: npm run issue -- say "what the others should know" --by "<agent>" --kind found')
  const channel = flags['all-games'] || !project ? 'all' : project.id
  try {
    const m = post({ channel, by, kind: str(flags.kind) ?? 'note', ticket: str(flags.ticket) ?? null, text })
    console.log(`posted to #${channel}: ${fmtMsg(m)}`)
  } catch (e) { fail(e.message) }
}

function inboxCommand () {
  const by = str(flags.by)
  if (!by) fail('inbox needs --by "<agent> [worktree]" (each reader keeps its own read position)')
  const list = flags.all ? channels().flatMap(c => readChannel(c, { limit: 200 })).sort((a, b) => a.at - b.at) : unread(channels(), by)
  console.log(CHANNEL_HEADER)
  if (!list.length) { console.log('no unread messages'); return }
  for (const m of list) console.log(fmtMsg(m))
  setCursor(by, Math.max(...list.map(m => m.at)))
}

function channelCommand () {
  const limit = Number(str(flags.limit) ?? 20)
  const list = channels().flatMap(c => readChannel(c, { limit })).sort((a, b) => a.at - b.at).slice(-limit)
  console.log(CHANNEL_HEADER)
  for (const m of list) console.log(fmtMsg(m))
  if (!list.length) console.log('(no messages yet)')
}

function oracleLockCommand () {
  const by = str(flags.by)
  if (!by) fail('oracle-lock needs --by user (only the user re-locks the checkers, after approving a change)')
  if (!project?.oracles?.length) fail(`projects.json lists no "oracles" for ${project?.id ?? 'this folder'}`)
  const n = lockOracles(project, by)
  console.log(`locked ${n} checker file(s) for ${project.id} (VN-Ports/oracles.lock.json - commit it in the VN-Ports root repo)`)
  try { post({ channel: project.id, by, kind: 'heads-up', text: `checker lock renewed for ${project.id} (${n} files) by ${by}` }) } catch {}
  if (!/^user\b/i.test(by)) console.log('note: the board shows a lock renewed by anyone but the user as needing attention.')
}

switch (command) {
  case 'list': listCommand(); break
  case 'show': showCommand(positional[0]); break
  case 'goal': goalCommand(); break
  case 'next': nextCommand(); break
  case 'audit': auditCommand(); break
  case 'rescue': rescueCommand(); break
  case 'new': newCommand(); break
  case 'claim': claimCommand(positional[0]); break
  case 'note': noteCommand(positional[0]); break
  case 'done': doneCommand(positional[0]); break
  case 'block': setStateCommand(positional[0], 'block', 'BLOCKED'); break
  case 'drop': setStateCommand(positional[0], 'drop', 'DROPPED'); break
  case 'plain': plainCommand(positional[0]); break
  case 'rate': rateCommand(positional[0]); break
  case 'progress': progressCommand(positional[0]); break
  case 'eta': etaCommand(positional[0]); break
  case 'needs': needsCommand(positional[0]); break
  case 'reopen': reopenCommand(positional[0]); break
  case 'model': case 'summary': case 'recovery': metadataCommand(positional[0], command); break
  case 'reviewed': reviewedCommand(positional[0]); break
  case 'learn': learnCommand(); break
  case 'rules': rulesCommand(); break
  case 'say': sayCommand(); break
  case 'inbox': inboxCommand(); break
  case 'channel': channelCommand(); break
  case 'proof': proofCommand(positional[0]); break
  case 'prove': proveCommand(positional[0]); break
  case 'oracle-lock': oracleLockCommand(); break
  case 'help': console.log(HELP); break
  default: fail(`unknown command "${command}"\n${HELP}`)
}
if (command === 'list' && positional.length === 0 && !Object.keys(flags).some(f => !['project', 'root'].includes(f))) {
  console.log('\ncommands: npm run issue -- list|show|goal|next|audit|rules|inbox|say|channel|new|claim|progress|eta|note|done|block|drop|reopen|plain|rate|needs|proof|prove|learn|help')
}
