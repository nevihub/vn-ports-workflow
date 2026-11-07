#!/usr/bin/env node
// Token report for OpenCode and Claude Code sessions. The Claude reader uses JSONL usage fields only.
// tickets closed per game. Read-only: opens opencode.db with readOnly and never writes.
//
//   npm run tokens                 last 7 days
//   npm run tokens -- --days 30
//   npm run tokens -- --since 2026-10-16
//   npm run tokens -- --source claude --days 7
//   npm run tokens -- --json
//
// Cost units are a rough weighting so cached reads do not hide the bill:
//   uncached input 1.0, cache read 0.1, cache write 1.25, output 3.0, reasoning 3.0
// Change them with --w-cache=0.1 etc. They are assumptions, not prices.

import { DatabaseSync } from "node:sqlite";
import { createReadStream, readFileSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeUsage, summarizePrompts } from "./lib/token-usage.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.OPENCODE_DB || path.join(homedir(), ".local/share/opencode/opencode.db");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith("--")) return args[i + 1];
  if (i >= 0) return true;
  return fallback;
};

const json = Boolean(flag("json", false));
const source = String(flag("source", "opencode")).toLowerCase();
const days = Number(flag("days", 7));
const sinceArg = flag("since", null);
const W = {
  cache: Number(flag("w-cache", 0.1)),
  cacheWrite: Number(flag("w-cache-write", 1.25)),
  output: Number(flag("w-output", 3)),
  reasoning: Number(flag("w-reasoning", 3)),
};

const since = sinceArg
  ? new Date(`${sinceArg}T00:00:00Z`).getTime()
  : Date.now() - days * 24 * 3600 * 1000;

const fmt = (n) => Math.round(n).toLocaleString("en-US");
const mtok = (n) => (n / 1e6).toFixed(1);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : "0.0");

function loadProjects() {
  const file = path.join(HERE, "projects.json");
  if (!existsSync(file)) return [];
  const data = JSON.parse(readFileSync(file, "utf8"));
  return (data.projects || []).map((p) => ({
    id: p.id,
    name: p.name,
    dirs: (p.paths || []).map((rel) => path.resolve(HERE, rel)),
    ledger: path.resolve(HERE, (p.paths || [])[0] || ".", "docs/BACKLOG.md"),
  }));
}

const projects = loadProjects();

async function claudeFiles (dir) {
  const out = [];
  async function visit (current) {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) out.push(file);
    }
  }
  await visit(dir);
  return out;
}

async function reportClaude () {
  const dir = process.env.CLAUDE_PROJECTS_DIR || path.join(homedir(), ".claude", "projects");
  if (!existsSync(dir)) {
    console.error(`no Claude project logs at ${dir}`);
    process.exitCode = 1;
    return;
  }

  const end = Date.now();
  const files = await claudeFiles(dir);
  const sessions = new Map();
  const seenRequests = new Map();
  let malformedRows = 0;
  let missingTimestamps = 0;

  for (const file of files) {
    const input = createReadStream(file, { encoding: "utf8" });
    const lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { malformedRows += 1; continue; }
      const usage = claudeUsage(record);
      if (!usage) continue;
      const sessionId = usage.sessionId || path.basename(file, ".jsonl");
      if (usage.requestId) {
        if (!seenRequests.has(sessionId)) seenRequests.set(sessionId, new Set());
        const seen = seenRequests.get(sessionId);
        if (seen.has(usage.requestId)) continue;
        seen.add(usage.requestId);
      }
      if (usage.timestampMs === null) { missingTimestamps += 1; continue; }
      if (!sessions.has(sessionId)) sessions.set(sessionId, { first: null, prompts: [] });
      const session = sessions.get(sessionId);
      if (!session.first || usage.timestampMs < session.first.timestampMs) session.first = usage;
      if (usage.timestampMs >= since && usage.timestampMs <= end) session.prompts.push(usage.prompt);
    }
  }

  const activeSessions = [...sessions.values()].filter(session => session.prompts.length);
  const prompts = activeSessions.flatMap(session => session.prompts);
  const requestSummary = summarizePrompts(prompts);
  const freshFirstPrompts = [...sessions.values()]
    .filter(session => session.first && session.first.timestampMs >= since && session.first.timestampMs <= end)
    .map(session => session.first.prompt);
  const firstSummary = summarizePrompts(freshFirstPrompts);
  const perSessionRequests = summarizePrompts(activeSessions.map(session => session.prompts.length));
  const perSessionAvgPrompt = summarizePrompts(activeSessions.map(session =>
    session.prompts.reduce((sum, prompt) => sum + prompt, 0) / session.prompts.length));
  const summary = {
    source: "claude",
    windowStart: new Date(since).toISOString().slice(0, 10),
    windowEnd: new Date(end).toISOString().slice(0, 10),
    sessions: activeSessions.length,
    requests: requestSummary.requests,
    avgPrompt: requestSummary.avgPrompt,
    p50Prompt: requestSummary.p50Prompt,
    p90Prompt: requestSummary.p90Prompt,
    over128k: requestSummary.over128k,
    over128kPct: requestSummary.over128kPct,
    over200k: requestSummary.over200k,
    over200kPct: requestSummary.over200kPct,
    firstRequest: {
      sessions: firstSummary.requests,
      avgPrompt: firstSummary.avgPrompt,
      p50Prompt: firstSummary.p50Prompt,
      p90Prompt: firstSummary.p90Prompt,
      over128kPct: firstSummary.over128kPct,
    },
    perSession: {
      avgRequests: perSessionRequests.avgPrompt,
      p50Requests: perSessionRequests.p50Prompt,
      p90Requests: perSessionRequests.p90Prompt,
      avgPrompt: perSessionAvgPrompt.avgPrompt,
      p50Prompt: perSessionAvgPrompt.p50Prompt,
      p90Prompt: perSessionAvgPrompt.p90Prompt,
    },
    malformedRows,
    missingTimestamps,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  console.log(`Claude token report  ${summary.windowStart} .. ${summary.windowEnd}`);
  console.log(`requests        ${fmt(summary.requests)} across ${summary.sessions} sessions`);
  console.log(`prompt avg/p50/p90 ${fmt(summary.avgPrompt)} / ${fmt(summary.p50Prompt)} / ${fmt(summary.p90Prompt)}`);
  console.log(`over 128K       ${summary.over128kPct}%   over 200K: ${summary.over200kPct}%`);
  console.log(`first request   ${fmt(summary.firstRequest.sessions)} fresh sessions; avg/p50/p90 ${fmt(summary.firstRequest.avgPrompt)} / ${fmt(summary.firstRequest.p50Prompt)} / ${fmt(summary.firstRequest.p90Prompt)}`);
  console.log(`per session     avg ${fmt(summary.perSession.avgRequests)} requests (p50 ${fmt(summary.perSession.p50Requests)}, p90 ${fmt(summary.perSession.p90Requests)}); mean prompt avg/p50/p90 ${fmt(summary.perSession.avgPrompt)} / ${fmt(summary.perSession.p50Prompt)} / ${fmt(summary.perSession.p90Prompt)}`);
  if (summary.malformedRows || summary.missingTimestamps) {
    console.log(`omitted rows     malformed ${fmt(summary.malformedRows)}; missing timestamps ${fmt(summary.missingTimestamps)}`);
  }
}

function matchGame(dir) {
  if (!dir) return null;
  const d = path.resolve(dir).toLowerCase();
  let best = null;
  for (const p of projects) {
    for (const root of p.dirs) {
      const r = root.toLowerCase();
      if (d === r || d.startsWith(r + path.sep) || d.startsWith(r + "/")) {
        if (!best || root.length > best.len) best = { id: p.id, len: root.length };
      }
    }
  }
  return best ? best.id : null;
}

// Worktree checkouts live under .../opencode/worktree/<first 6 chars of project id>/<name>.
// Resolve them to the game of the project they were cut from.
const worktreePrefix = new Map();
for (const p of projects) worktreePrefix.set(p.id.slice(0, 6), p.id);

function gameFor(dir) {
  const direct = matchGame(dir);
  if (direct) return direct;
  if (!dir) return null;
  const m = path.resolve(dir).toLowerCase().match(/[\\/]opencode[\\/]worktree[\\/]([0-9a-f]{6})[\\/]/);
  if (m) {
    const id = worktreePrefix.get(m[1]);
    if (id) return id;
  }
  const d = path.resolve(dir).toLowerCase();
  if (d.includes("vn-ports-workflow") || d.endsWith("vn-ports") || d.includes(`${path.sep}vn-ports${path.sep}board`)) {
    return "workflow";
  }
  return null;
}

function ticketsDone(from, to) {
  const out = {};
  for (const p of projects) {
    if (!existsSync(p.ledger)) continue;
    const text = readFileSync(p.ledger, "utf8");
    let n = 0;
    for (const m of text.matchAll(/Status:\s*DONE\s+(\d{4}-\d{2}-\d{2})/g)) {
      const t = new Date(`${m[1]}T12:00:00Z`).getTime();
      if (t >= from && t <= to) n += 1;
    }
    out[p.id] = n;
  }
  return out;
}

if (source === "claude") {
  await reportClaude();
} else {
if (source !== "opencode") {
  console.error(`unknown token source ${source}; choose opencode or claude`);
  process.exit(1);
} else if (!existsSync(DB)) {
  console.error(`no OpenCode database at ${DB}\nset OPENCODE_DB to point at opencode.db`);
  process.exit(1);
}

let db;
try {
  db = new DatabaseSync(DB, { readOnly: true });
} catch (err) {
  console.error(`cannot open ${DB}: ${err.message}`);
  console.error("node:sqlite needs Node 22.5+ (you have " + process.version + ")");
  process.exit(1);
}

const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));

// Session -> game, from the directory the session ran in.
const sessionGame = new Map();
for (const row of db.prepare("select id, directory, parent_id from session_v2").all()) {
  sessionGame.set(row.id, gameFor(row.directory));
}

const blank = () => ({
  sessions: new Set(),
  prompts: [],
  firstRequestPrompts: [],
  requests: 0,
  uncached: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  reasoning: 0,
  over128k: 0,
  over200k: 0,
  misses: 0,
  missTokens: 0,
  toolCalls: 0,
  toolOut: 0,
  repeatReads: 0,
  repeatReadTokens: 0,
  bigOut: 0,
});

const total = blank();
const byGame = new Map();
const byDay = new Map();
const pathsBySession = new Map();

const rows = db
  .prepare("select session_id, type, time_created, data from session_message where type in ('assistant') order by session_id, seq")
  .all();

const firstOpenCodeRequest = new Map();
for (const row of rows) {
  let d;
  try {
    d = JSON.parse(row.data);
  } catch {
    continue;
  }
  if (!d.tokens) continue;

  const t = d.tokens;
  const c = t.cache || {};
  const uncached = t.input || 0;
  const cacheRead = c.read || 0;
  const cacheWrite = c.write || 0;
  const out = t.output || 0;
  const reason = t.reasoning || 0;
  const prompt = uncached + cacheRead + cacheWrite;
  const game = sessionGame.get(row.session_id) || "other";

  if (!firstOpenCodeRequest.has(row.session_id)) {
    firstOpenCodeRequest.set(row.session_id, { prompt, time: row.time_created, game });
  }
  if (row.time_created < since) continue;

  const add = (b) => {
    b.sessions.add(row.session_id);
    b.requests += 1;
    b.prompts.push(prompt);
    b.uncached += uncached;
    b.cacheRead += cacheRead;
    b.cacheWrite += cacheWrite;
    b.output += out;
    b.reasoning += reason;
    if (prompt > 128000) b.over128k += 1;
    if (prompt > 200000) b.over200k += 1;
    if (uncached > 20000) {
      b.misses += 1;
      b.missTokens += uncached;
    }
  };
  add(total);
  if (!byGame.has(game)) byGame.set(game, blank());
  add(byGame.get(game));

  const day = new Date(row.time_created).toISOString().slice(0, 10);
  if (!byDay.has(day)) byDay.set(day, blank());
  add(byDay.get(day));

  for (const part of d.content || []) {
    if (part.type !== "tool") continue;
    let len = 0;
    for (const p of (part.state && part.state.content) || []) if (p.type === "text") len += (p.text || "").length;
    const tok = len / 4;

    const bump = (b) => {
      b.toolCalls += 1;
      b.toolOut += tok;
      if (tok > 4000) b.bigOut += 1;
    };
    bump(total);
    bump(byGame.get(game));
    bump(byDay.get(day));

    if (part.name === "read") {
      const file = ((part.state && part.state.input && part.state.input.path) || "").toLowerCase();
      if (!pathsBySession.has(row.session_id)) pathsBySession.set(row.session_id, new Map());
      const seen = pathsBySession.get(row.session_id);
      if (seen.has(file)) {
        total.repeatReads += 1;
        total.repeatReadTokens += tok;
        const g = byGame.get(game);
        g.repeatReads += 1;
        g.repeatReadTokens += tok;
      } else {
        seen.set(file, true);
      }
    }
  }
}

for (const [sessionId, first] of firstOpenCodeRequest) {
  if (first.time < since || first.time > Date.now()) continue;
  total.firstRequestPrompts.push(first.prompt);
  const game = byGame.get(first.game);
  if (game) game.firstRequestPrompts.push(first.prompt);
}

const costUnits = (b) =>
  b.uncached + b.cacheRead * W.cache + b.cacheWrite * W.cacheWrite + b.output * W.output + b.reasoning * W.reasoning;

const done = ticketsDone(since, Date.now());
const doneTotal = Object.values(done).reduce((a, b) => a + b, 0);

function table(rowsIn) {
  const head = [
    "game".padEnd(10),
    "req".padStart(7),
    "uncached".padStart(10),
    "cache".padStart(10),
    "out+rsn".padStart(9),
    "cost".padStart(9),
    "avgPrompt".padStart(10),
    ">128K".padStart(7),
    "repRead".padStart(8),
    "misses".padStart(7),
    "done".padStart(5),
    "M/ticket".padStart(9),
  ].join(" ");
  const lines = [head];
  for (const r of rowsIn) {
    lines.push(
      [
        String(r.name).slice(0, 10).padEnd(10),
        fmt(r.requests).padStart(7),
        mtok(r.uncached).padStart(10),
        mtok(r.cacheRead).padStart(10),
        mtok(r.output + r.reasoning).padStart(9),
        mtok(r.cost).padStart(9),
        fmt(summarizePrompts(r.prompts).avgPrompt).padStart(10),
        pct(r.over128k, r.requests).padStart(6) + "%",
        fmt(r.repeatReadTokens).padStart(8),
        fmt(r.misses).padStart(7),
        String(r.done ?? 0).padStart(5),
        (r.done ? (r.uncached + r.cacheRead) / 1e6 / r.done : 0).toFixed(1).padStart(9),
      ].join(" "),
    );
  }
  return lines.join("\n");
}

const perGame = [...byGame.entries()]
  .map(([id, b]) => ({
    id,
    name: id === "other" ? "other" : id === "workflow" ? "root/board" : (projectsById[id]?.name || id),
    ...b,
    cost: costUnits(b),
    done: id === "other" || id === "workflow" ? null : done[id] ?? 0,
  }))
  .sort((a, b) => b.uncached + b.cacheRead - (a.uncached + a.cacheRead));

const promptStats = summarizePrompts(total.prompts);
const firstPromptStats = summarizePrompts(total.firstRequestPrompts);
const summary = {
  source: "opencode",
  windowStart: new Date(since).toISOString().slice(0, 10),
  windowEnd: new Date().toISOString().slice(0, 10),
  database: DB,
  sessions: total.sessions.size,
  requests: total.requests,
  uncachedInput: Math.round(total.uncached),
  cacheRead: Math.round(total.cacheRead),
  cacheWrite: Math.round(total.cacheWrite),
  output: Math.round(total.output),
  reasoning: Math.round(total.reasoning),
  promptTokens: Math.round(total.uncached + total.cacheRead + total.cacheWrite),
  cacheHitPct: um(total.cacheRead, total.cacheRead + total.uncached),
  costUnits: Math.round(costUnits(total)),
  avgPrompt: promptStats.avgPrompt,
  p50Prompt: promptStats.p50Prompt,
  p90Prompt: promptStats.p90Prompt,
  over128kPct: um(total.over128k, total.requests),
  over200kPct: um(total.over200k, total.requests),
  firstRequest: {
    sessions: firstPromptStats.requests,
    avgPrompt: firstPromptStats.avgPrompt,
    p50Prompt: firstPromptStats.p50Prompt,
    p90Prompt: firstPromptStats.p90Prompt,
    over128kPct: firstPromptStats.over128kPct,
  },
  toolCalls: total.toolCalls,
  toolOutputTokens: Math.round(total.toolOut),
  bigToolOutputs: total.bigOut,
  repeatReads: total.repeatReads,
  repeatReadTokens: Math.round(total.repeatReadTokens),
  bigCacheMisses: total.misses,
  bigCacheMissTokens: Math.round(total.missTokens),
  ticketsDone: doneTotal,
  tokensPerTicket: doneTotal ? Math.round((total.uncached + total.cacheRead) / doneTotal) : null,
  weights: W,
  perGame: perGame.map((g) => ({
    game: g.name,
    requests: g.requests,
    uncachedInput: Math.round(g.uncached),
    cacheRead: Math.round(g.cacheRead),
    output: Math.round(g.output),
    reasoning: Math.round(g.reasoning),
    costUnits: Math.round(costUnits(g)),
    avgPrompt: summarizePrompts(g.prompts).avgPrompt,
    p50Prompt: summarizePrompts(g.prompts).p50Prompt,
    p90Prompt: summarizePrompts(g.prompts).p90Prompt,
    firstRequest: {
      sessions: g.firstRequestPrompts.length,
      avgPrompt: summarizePrompts(g.firstRequestPrompts).avgPrompt,
      p50Prompt: summarizePrompts(g.firstRequestPrompts).p50Prompt,
      p90Prompt: summarizePrompts(g.firstRequestPrompts).p90Prompt,
    },
    over128kPct: um(g.over128k, g.requests),
    repeatReadTokens: Math.round(g.repeatReadTokens),
    bigCacheMisses: g.misses,
    ticketsDone: g.done,
    tokensPerTicket: g.done ? Math.round((g.uncached + g.cacheRead) / g.done) : null,
  })),
  perDay: [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([day, b]) => ({
      day,
      requests: b.requests,
      promptTokens: Math.round(b.prompts.reduce((sum, n) => sum + n, 0)),
      costUnits: Math.round(costUnits(b)),
      avgPrompt: summarizePrompts(b.prompts).avgPrompt,
    })),
};

function um(a, b) {
  return b ? Number(((100 * a) / b).toFixed(1)) : 0;
}

if (json) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

console.log(`OpenCode token report  ${summary.windowStart} .. ${summary.windowEnd}`);
console.log(`database ${DB}`);
console.log("");
console.log(`requests        ${fmt(summary.requests)} across ${summary.sessions} sessions`);
console.log(`prompt tokens   ${mtok(summary.promptTokens)}M  (cached ${summary.cacheHitPct}%)`);
console.log(`  uncached      ${mtok(summary.uncachedInput)}M`);
console.log(`  cache read    ${mtok(summary.cacheRead)}M`);
console.log(`output+reason   ${mtok(summary.output + summary.reasoning)}M  (reasoning ${mtok(summary.reasoning)}M)`);
console.log(`cost units      ${mtok(summary.costUnits)}M  (uncached 1, cache ${W.cache}, output ${W.output})`);
console.log("");
console.log(`avg/p50/p90     ${fmt(summary.avgPrompt)} / ${fmt(summary.p50Prompt)} / ${fmt(summary.p90Prompt)} prompt; over 128K: ${summary.over128kPct}%   over 200K: ${summary.over200kPct}%`);
console.log(`first request   ${fmt(summary.firstRequest.sessions)} fresh sessions; avg/p50/p90 ${fmt(summary.firstRequest.avgPrompt)} / ${fmt(summary.firstRequest.p50Prompt)} / ${fmt(summary.firstRequest.p90Prompt)}`);
console.log(`tool calls      ${fmt(summary.toolCalls)}   output ${mtok(summary.toolOutputTokens)}M   >4K outputs: ${fmt(summary.bigToolOutputs)}`);
console.log(`repeat reads    ${fmt(summary.repeatReads)} calls, ${mtok(summary.repeatReadTokens)}M tokens`);
console.log(`cache misses    ${fmt(summary.bigCacheMisses)} requests >20K uncached, ${mtok(summary.bigCacheMissTokens)}M uncached`);
console.log("");
console.log(`tickets done    ${summary.ticketsDone}   tokens per ticket: ${summary.tokensPerTicket ? mtok(summary.tokensPerTicket) + "M" : "n/a"}`);
console.log("(games are matched by session working directory; sessions run in the VN-Ports root or");
console.log(" worktrees outside a game folder show up under root/board or other)");
console.log("");
console.log(table(perGame));
console.log("");
console.log("Recent days (newest first):");
for (const d of summary.perDay.slice(0, 8)) {
  console.log(
    `  ${d.day}  req ${String(d.requests).padStart(5)}  prompt ${mtok(d.promptTokens).padStart(7)}M  avg ${fmt(d.avgPrompt).padStart(7)}  cost ${mtok(d.costUnits).padStart(5)}M`,
  );
}
}
