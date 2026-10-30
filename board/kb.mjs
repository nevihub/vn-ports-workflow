#!/usr/bin/env node
// Cross-port search - `npm run kb -- "<words>"` (here or at the VN-Ports root). Every word must appear on the line.
// Reads only an allowlist: knowledge\*.md, the root AGENTS.md, and each game's agent docs (AGENTS/CLAUDE/HANDOFF/
// STATUS/README and docs\DECISIONS/BACKLOG/HISTORY/LESSONS/WORKFLOW/MOBILE*/*SPEC*/COMMANDS). Never game data.
//   --project <id>   only that game (plus knowledge)      --limit N   max hits (default 60)
import { statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { kbFiles, kbSearch, VN_ROOT } from './lib/knowledge.mjs'
import { loadProjects } from './lib/projects.mjs'

const argv = process.argv.slice(2).filter(a => a !== '--')
const flag = name => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : null }
const hasCheckout = argv.includes('--root')
const only = flag('--project')
const checkout = flag('--root')
const limit = Number(flag('--limit') ?? 60)
const query = argv.join(' ').trim()
if (!query) {
  console.log('usage: npm run kb -- "<words>" [--project <id> [--root <checkout>]] [--limit N]')
  process.exit(1)
}
const projects = loadProjects().filter(p => !only || p.id === only)
const fail = message => { console.error(message); process.exit(1) }
if (hasCheckout && (!checkout || checkout.startsWith('--'))) fail('--root needs a checkout path')
if (checkout) {
  if (!only || projects.length !== 1) fail('--root requires --project with a known project id')
  const root = resolve(checkout)
  try {
    if (!statSync(root).isDirectory()) fail('--root must be an existing checkout directory')
  } catch { fail('--root must be an existing checkout directory') }
  // Replace this project's source, rather than mixing old and current context.
  // kbFiles still applies the same non-recursive document allowlist.
  projects[0] = { ...projects[0], root }
}
const files = kbFiles(projects).filter(f => !only || f.label === only || f.label === 'knowledge' || f.label === 'vn-ports')
const hits = kbSearch(query, files, { limit: limit + 1 })
for (const h of hits.slice(0, limit)) {
  const text = h.text.length > 220 ? `${h.text.slice(0, 217)}...` : h.text
  console.log(`[${h.label}] ${relative(VN_ROOT, h.path)}:${h.line}  ${text}`)
}
console.log(`\n${Math.min(hits.length, limit)}${hits.length > limit ? '+' : ''} hit(s) in ${files.length} allowlisted files${hits.length > limit ? ' - narrow the words or raise --limit' : ''}`)
