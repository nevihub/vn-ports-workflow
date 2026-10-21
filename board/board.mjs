#!/usr/bin/env node
// Shared live ticket board for every VN port in this folder (projects.json) - `npm run board` here, or
// `npm run board` inside a project (a thin wrapper that opens this board on that project).
//
//   node board.mjs [--project <id>]   make sure the little local server runs (127.0.0.1:5461+), then open the browser
//   node board.mjs --once             write a static snapshot (all projects) to state/board.html and open it
//   node board.mjs --stop             stop the server
//   node board.mjs --serve            run the server in the foreground (debugging; the default spawns this detached)
//   node board.mjs --no-open          do not open a browser
//
// The server is read-only except /shutdown: without BOARD_TOKEN that route needs the x-board header
// (a random web page cannot stop it); with BOARD_TOKEN set it needs the token header instead, so set the
// token whenever a tunnel exposes the board beyond this machine. It never serves game data: it reads each project's
// docs/BACKLOG.md and HANDOFF.md/STATUS.md, plus every other checkout's ledger (git worktrees, read-only), so in-flight
// claims in other copies are visible. Port 5461 first: the phone tunnel (board.example.com) points there.
// State: state/board-server.json (ignored). Page: board-page.html. Ledger maths: lib/ledger.mjs.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { claimWorktree, history, lastNoteAt, summarise } from './lib/ledger.mjs'
import { summarizeMaintainer } from './lib/maintainer.mjs'
import { read as readChannel } from './lib/channel.mjs'
import { recentLessons } from './lib/knowledge.mjs'
import { loadProjects } from './lib/projects.mjs'
import { cachedPage } from './lib/page-cache.mjs'
import { completeAudit, loadProjectState, projectGoal } from './lib/project-state.mjs'

const SELF = fileURLToPath(import.meta.url)
const HERE = dirname(SELF)
const PAGE_PATH = join(HERE, 'board-page.html')
const APP = 'vn-ports-board'
const PORTS = [5461, 5462, 5463, 5464, 5465, 5466, 5467, 5468]
const STALE_HOURS = 2
const outDir = join(HERE, 'state')
const statePath = join(outDir, 'board-server.json')
const oncePath = join(outDir, 'board.html')
const args = process.argv.slice(2)
const argValue = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] ?? null : null }
const sleep = ms => new Promise(r => setTimeout(r, ms))
// The server restarts itself when its code changes (board.mjs or anything in lib/).
const codeMtime = () => Math.max(statSync(SELF).mtimeMs, ...readdirSync(join(HERE, 'lib')).map(f => statSync(join(HERE, 'lib', f)).mtimeMs))

const fnv = s => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16)
}
const readText = p => { try { return readFileSync(p, 'utf8') } catch { return null } }

export { loadProjects }

// Mutating surface: only /shutdown changes server state, and only with proof it is us.
// Without BOARD_TOKEN (plain local use) it needs the x-board header, which a random web page
// cannot forge into a POST... actually any local page or extension CAN send that header, and a
// tunnel turns local into remote. So: set BOARD_TOKEN whenever the board is reachable beyond this
// machine (phone tunnel); then /shutdown needs the token and the header alone is refused.
export function shutdownHeaders () {
  const headers = { 'x-board': 'yes' }
  if (process.env.BOARD_TOKEN) headers['x-board-token'] = process.env.BOARD_TOKEN
  return headers
}

// Separated for tests: the read-only routes never check this.
export function shutdownAllowed (req) {
  const token = process.env.BOARD_TOKEN
  if (token) return req.headers['x-board-token'] === token
  return req.headers['x-board'] === 'yes'
}

const grabFrom = (root, spec, key) => {
  if (!spec?.file || !spec[key]) return null
  const text = readText(join(root, spec.file))
  return text?.match(new RegExp(spec[key], 'i'))?.[1]?.trim() ?? null
}

// Everything the page needs for one project, as plain JSON.
export function collect (project, { now = Date.now() } = {}) {
  const base = { type: 'data', id: project.id, name: project.name, full: project.full ?? null, rootPath: project.root,
    lanes: project.lanes ?? {}, prompt: project.prompt ?? null, models: project.models ?? {}, generatedAt: new Date(now).toISOString(),
    localPlay: project.localPlay ?? null }
  const live = project.live && project.root ? grabFrom(project.root, project.live, 'regex') : null
  const state = loadProjectState(project, { now, boardStatusCache: true })
  const md = state.md
  if (!state.hasLedger) {
    const fb = project.fallback
    const fbProgress = project.root ? grabFrom(project.root, fb, 'progress') : null
    const fbPlayable = project.root ? grabFrom(project.root, fb, 'playable') : null
    return { ...base, hasLedger: false, found: Boolean(project.root), live, items: [], summary: summarise([]),
      timeline: null, history: [], overall: fbProgress ? Math.round(Number(fbProgress)) : null, overallSource: fbProgress ? 'status file' : null,
      playable: fbPlayable ? { text: fbPlayable, yes: /^yes$/i.test(fbPlayable) } : (fb?.playableIfLive && live ? { text: 'yes', yes: true } : null),
      version: fnv(`${project.id}|none|${live}|${fbProgress}|${fbPlayable}|${project.localPlay ?? ''}`) }
  }
  const lines = md.split('\n')
  const parsed = state.items
  const wt = state.worktrees
  const { claims, ghosts } = state
  const goal = projectGoal(state)
  const hhmm = ms => new Date(ms).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
  const commitAt = commit => (commit ? wt.commits.get(String(commit).slice(0, 7)) ?? null : null)
  const enrich = (it, claim, raw) => {
    const state = claim ? claim.state : it.state
    const pick = k => (claim ? (claim[k] ?? it[k]) : it[k])
    let time = pick('time')
    const date = pick('date')
    const commit = pick('commit')
    let at = date && time ? Date.parse(`${date}T${time}:00`) : (date ? Date.parse(`${date}T00:00:00`) : null)
    if (state === 'done' && !time && commit) {
      const ms = commitAt(commit)
      if (ms) { at = ms; time = hhmm(ms) }
    }
    let staleHours = null
    if (state === 'claimed') {
      const progAt = Date.parse(pick('progressAt') ?? '')
      const last = Math.max(at ?? 0, lastNoteAt(it.notes) ?? 0, Number.isFinite(progAt) ? progAt : 0)
      if (last && now - last > STALE_HOURS * 3600_000) staleHours = Math.floor((now - last) / 3600_000)
    }
    const body = raw ? raw.slice(1).filter(l => l.trim() && !/^\**([A-Za-z]+)\**:/.test(l) && !/^\s*-\s+/.test(l)).join(' ') : ''
    return {
      id: it.id, lane: it.lane, title: it.title, plain: it.plain, prio: it.prio, impact: it.impact, worth: it.worth,
      progress: pick('progress'), percent: pick('percent'), doing: pick('doing'), state, type: it.type,
      owner: pick('owner'), date, time, at, commit, reason: pick('reason'), gate: it.gate, notes: it.notes, body: body || null,
      note: pick('note'), created: pick('created'), createdBy: pick('createdBy'), model: pick('model'),
      result: pick('result'), before: pick('before'), after: pick('after'), evidence: pick('evidence'), waiver: pick('waiver'),
      unblock: pick('unblock'), related: pick('related') ?? [], topics: pick('topics') ?? [],
      blockedAt: pick('blockedAt'), reviewed: pick('reviewed'),
      tickets: it.tickets, weight: it.weight, playableStage: it.playableStage, hasStatus: it.hasStatus, staleHours,
      needs: it.needs ?? [], agents: it.agents ?? null, proof: it.proof ?? null,
    }
  }
  const items = parsed.map(it => {
    const raw = lines.slice(it.start, it.end)
    const claim = claims.get(it.id) ?? null
    const out = enrich(it, claim, raw)
    out.worktree = claim ? claim.worktree : (it.state === 'claimed' ? claimWorktree(it.owner, wt.porcelain) : null)
    out.branch = claim?.branch ?? null
    out.notMerged = Boolean(claim)
    out.v = fnv(raw.join('\n') + (claim ? `|x:${out.state}|${out.owner}` : '') + (out.staleHours ? `|s${out.staleHours}` : ''))
    return out
  })
  for (const g of ghosts) {
    const out = enrich(g, null, null)
    Object.assign(out, { worktree: g.worktree, branch: g.branch, notMerged: true, ghost: true, v: fnv(`elsewhere|${g.worktree}|${g.raw ?? ''}`) })
    items.push(out)
  }
  const tl = goal.timeline
  const hasTimeline = tl.stages.length > 0
  const messages = [...readChannel(project.id, { limit: 30 }), ...readChannel('all', { limit: 10 })].sort((a, b) => b.at - a.at).slice(0, 30)
  const recoveryMessages = [...readChannel(project.id, { limit: 200 }), ...readChannel('all', { limit: 200 })].sort((a, b) => b.at - a.at)
  const auditState = { ...state, effective: items }
  const { findings: attention, plans: recovery } = completeAudit(auditState, { project, messages: recoveryMessages, lessons: recentLessons(200), now })
  const fbProgress = hasTimeline ? null : grabFrom(project.root, project.fallback, 'progress')
  const fbPlayable = grabFrom(project.root, project.fallback, 'playable')
  const playable = tl.playable
    ? { text: tl.playable.yes ? 'yes' : 'not yet', yes: tl.playable.yes, missing: tl.playable.missing, stage: tl.playable.stage }
    : (fbPlayable ? { text: fbPlayable, yes: /^yes$/i.test(fbPlayable) } : null)
  const maintainer = { ...summarizeMaintainer({ items, messages }), dirty: state.dirty, worktrees: wt.sources.map(s => s.name) }
  return {
    ...base, hasLedger: true, found: true, live,
    pageVersion: cachedPage(PAGE_PATH).version,
    version: fnv(items.map(i => i.v).join(':') + `|${live}|${project.localPlay ?? ''}|${attention.map(a => a.code + a.id).join()}|${messages[0]?.at ?? 0}|${JSON.stringify(recovery)}|${JSON.stringify(maintainer)}`),
    overall: hasTimeline ? tl.overall : (fbProgress ? Number(fbProgress) : null),
    overallSource: hasTimeline ? 'timeline' : (fbProgress ? 'handoff' : null),
    playable,
    summary: summarise(items),
    timeline: hasTimeline ? tl : null,
    history: history(items),
    attention,
    messages,
    recovery,
    maintainer,
    ready: goal.ready.map(i => i.id),
    combos: goal.combos,
    order: goal.order,
    items: items.filter(i => i.lane !== 'S'),
  }
}

// Newest agent-channel messages across every game (and the all-ports channel) for the All ports view.
export function allMessages (limit = 15) {
  return [...loadProjects().map(p => p.id), 'all'].flatMap(c => readChannel(c, { limit })).sort((a, b) => b.at - a.at).slice(0, limit)
}

export function overview (projects) {
  return projects.map(p => {
    let d
    try { d = collect(p) } catch (e) { return { id: p.id, name: p.name, error: String(e) } }
    const here = d.timeline?.stages.find(s => s.id === d.timeline.here) ?? null
    return { id: p.id, name: p.name, full: p.full ?? null, found: d.found, hasLedger: d.hasLedger, overall: d.overall,
      overallSource: d.overallSource, playable: d.playable, live: d.live, localPlay: d.localPlay ?? null, summary: d.summary,
      attention: (d.attention ?? []).filter(f => f.level !== 'info').length, ready: (d.ready ?? []).length,
      maintainer: d.maintainer ? { merge: d.maintainer.mergeQueue.length, ghosts: d.maintainer.ghosts.length,
        stale: d.maintainer.stale.length, dirty: d.maintainer.dirty.count, lastSweepAt: d.maintainer.lastSweepAt,
        thinking: d.maintainer.thinking.slice(0, 1) } : null,
      here: here ? { id: here.id, title: here.title, percent: here.percent } : null, version: d.version }
  })
}

const page = data => {
  const { shell, version } = cachedPage(PAGE_PATH)
  const pv = `<script>window.__PAGE_V__ = "${version}"</script>`
  const tag = data ? `<script>window.__BOARD__ = ${JSON.stringify(data).replace(/</g, '\\u003c')}</script>` : ''
  return shell.replace('<!-- __PAGE_V__ -->', pv).replace('<!-- __BOARD_DATA__ -->', tag)
}

async function health (port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(700) })
    if (!r.ok) return null
    const j = await r.json()
    return j.app ? j : null
  } catch { return null }
}

async function findServer ({ any = false } = {}) {
  try {
    const st = JSON.parse(readFileSync(statePath, 'utf8'))
    const h = await health(st.port)
    if (h && (any || h.app === APP)) return { ...st, ...h }
  } catch {}
  for (const p of PORTS) {
    const h = await health(p)
    if (h && (any || h.app === APP)) return { port: p, ...h }
  }
  return null
}

async function stopAt (port) {
  try { await fetch(`http://127.0.0.1:${port}/shutdown`, { headers: shutdownHeaders() }) } catch {}
  for (let i = 0; i < 30; i++) {
    if (!(await health(port))) return true
    await sleep(100)
  }
  return false
}

async function stopServer (quiet) {
  const found = await findServer()
  if (!found) {
    if (!quiet) console.log('board: not running')
    return false
  }
  await stopAt(found.port)
  try { unlinkSync(statePath) } catch {}
  if (!quiet) console.log(`board: stopped (:${found.port})`)
  return true
}

function spawnServer () {
  const child = spawn(process.execPath, [SELF, '--serve'], {
    cwd: HERE, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, BOARD_CHILD: '1' },
  })
  child.unref()
}

async function openUrl (target) {
  if (process.platform === 'win32') {
    try {
      spawn('cmd', ['/c', 'start', '', `"${target}"`], { windowsHide: true, detached: true, stdio: 'ignore' }).unref()
      return
    } catch {}
  }
  console.log(`open: ${target}`)
}

function serve () {
  const startedAt = Date.now()
  const scriptMtime = codeMtime()
  let currentPort = 0
  const bye = () => {
    try {
      const st = JSON.parse(readFileSync(statePath, 'utf8'))
      if (st.port === currentPort) unlinkSync(statePath)
    } catch {}
    process.exit(0)
  }
  const handler = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const send = (code, type, body) => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' })
      res.end(body)
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Max-Age': '86400' })
      return res.end()
    }
    if (url.pathname === '/health') {
      return send(200, 'application/json', JSON.stringify({ app: APP, pid: process.pid, startedAt, scriptMtime }))
    }
    if (url.pathname === '/shutdown') {
      if (!shutdownAllowed(req)) return send(403, 'text/plain', 'forbidden')
      send(200, 'application/json', '{"ok":true}')
      return setTimeout(bye, 60)
    }
    try {
      if (url.pathname === '/projects.json') {
        const list = overview(loadProjects())
        return send(200, 'application/json', JSON.stringify({ type: 'overview', pageVersion: cachedPage(PAGE_PATH).version, projects: list, lessons: recentLessons(30), messages: allMessages() }))
      }
      if (url.pathname === '/data.json') {
        const projects = loadProjects()
        const p = projects.find(x => x.id === url.searchParams.get('p')) ?? projects[0]
        return send(200, 'application/json', JSON.stringify(collect(p)))
      }
    } catch (e) { return send(500, 'application/json', JSON.stringify({ error: String(e) })) }
    if (url.pathname === '/' || url.pathname === '/index.html') return send(200, 'text/html; charset=utf-8', page(null))
    send(404, 'text/plain', 'not found')
  }
  const tryListen = i => {
    if (i >= PORTS.length) {
      console.error(`board: no free port in ${PORTS[0]}..${PORTS[PORTS.length - 1]}`)
      process.exit(1)
    }
    const port = PORTS[i]
    const server = createServer(handler)
    server.once('error', e => {
      if (e.code === 'EADDRINUSE') tryListen(i + 1)
      else { console.error('board:', e.message); process.exit(1) }
    })
    server.listen(port, '127.0.0.1', () => {
      currentPort = port
      try {
        mkdirSync(outDir, { recursive: true })
        writeFileSync(statePath, JSON.stringify({ app: APP, port, pid: process.pid, startedAt, scriptMtime }))
      } catch {}
      console.log(`board server: http://127.0.0.1:${port}${process.env.BOARD_CHILD ? '' : '  (Ctrl-C stops it)'}`)
    })
  }
  process.on('SIGINT', bye)
  tryListen(0)
}

async function main () {
  const scriptMtime = codeMtime()
  // A per-project board (the old copies) still holding 5461 is replaced by this shared one.
  const first = await health(PORTS[0])
  if (first && first.app !== APP) {
    console.log(`board: replacing the old ${first.app} on :${PORTS[0]}`)
    await stopAt(PORTS[0])
  }
  const existing = await findServer()
  let port = null
  if (existing && existing.scriptMtime === scriptMtime) port = existing.port
  else if (existing) {
    console.log('board: restarting (the script changed)')
    await stopServer(true)
  }
  if (!port) {
    spawnServer()
    for (let i = 0; i < 50 && !port; i++) {
      await sleep(100)
      const f = await findServer()
      if (f) port = f.port
    }
  }
  if (!port) {
    console.error('board: server did not come up')
    process.exit(1)
  }
  const proj = argValue('--project')
  const url = `http://127.0.0.1:${port}/${proj ? `#p=${encodeURIComponent(proj)}` : ''}`
  console.log(`board: ${url}`)
  console.log('live: it refreshes itself; stop with: node board.mjs --stop')
  if (!args.includes('--no-open')) await openUrl(url)
}

const isMain = process.argv[1] && resolve(process.argv[1]) === SELF
if (isMain) {
  if (args.includes('--serve')) serve()
  else if (args.includes('--stop')) await stopServer(false)
  else if (args.includes('--once')) {
    const projects = loadProjects()
    const snapshot = { type: 'snapshot', projects: overview(projects), lessons: recentLessons(30), messages: allMessages(), data: Object.fromEntries(projects.map(p => [p.id, collect(p)])) }
    mkdirSync(outDir, { recursive: true })
    writeFileSync(oncePath, page(snapshot))
    console.log(`board snapshot: ${oncePath}`)
    if (!args.includes('--no-open')) await openUrl(oncePath)
  } else await main()
}
