#!/usr/bin/env node
// Cross-port search - `npm run kb -- "<words>"` (here or at the VN-Ports root). Every word must appear on the line.
// Reads only an allowlist: knowledge\*.md, the root AGENTS.md, and each game's agent docs (AGENTS/CLAUDE/HANDOFF/
// STATUS/README and docs\DECISIONS/BACKLOG/HISTORY/LESSONS/WORKFLOW/MOBILE*/*SPEC*/COMMANDS). Never game data.
//   --project <id>   only that game (plus knowledge)      --limit N   max hits (default 60)
import { relative } from 'node:path'
import { kbFiles, kbSearch, VN_ROOT } from './lib/knowledge.mjs'
import { loadProjects } from './lib/projects.mjs'

const argv = process.argv.slice(2).filter(a => a !== '--')
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : null }
const only = flag('--project')
const limit = Number(flag('--limit') ?? 60)
const query = argv.join(' ').trim()
if (!query) {
  console.log('usage: npm run kb -- "<words>" [--project subahibi|sakura|saya] [--limit N]')
  process.exit(1)
}
const projects = loadProjects().filter(p => !only || p.id === only)
const files = kbFiles(projects).filter(f => !only || f.label === only || f.label === 'knowledge' || f.label === 'vn-ports')
const hits = kbSearch(query, files, { limit: limit + 1 })
for (const h of hits.slice(0, limit)) {
  const text = h.text.length > 220 ? `${h.text.slice(0, 217)}...` : h.text
  console.log(`[${h.label}] ${relative(VN_ROOT, h.path)}:${h.line}  ${text}`)
}
console.log(`\n${Math.min(hits.length, limit)}${hits.length > limit ? '+' : ''} hit(s) in ${files.length} allowlisted files${hits.length > limit ? ' - narrow the words or raise --limit' : ''}`)
