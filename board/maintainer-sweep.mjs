#!/usr/bin/env node
// Shared, read-only status across VN ports, plus optional channel posts.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANNEL_DIR, HEADER as CHANNEL_HEADER, fmt as fmtMessage, post, read as readChannel } from './lib/channel.mjs'
import { buildNudges, NUDGE_AFTER_HOURS } from './lib/maintainer.mjs'
import { recentLessons } from './lib/knowledge.mjs'
import { completeAudit, formatGoal, loadProjectState, projectGoal } from './lib/project-state.mjs'
import { loadProjects } from './lib/projects.mjs'

function option (args, name, fallback = null) {
  const i = args.indexOf(name)
  if (i < 0) return fallback
  const value = args[i + 1]
  return value && !value.startsWith('--') ? value : true
}

function messageList (project, limit, dir) {
  return [
    ...readChannel(project, { limit, dir }),
    ...readChannel('all', { limit, dir }),
  ].sort((a, b) => a.at - b.at).slice(-limit)
}

function summarize (project, { limit, nudgeAfter, now, channelDir }) {
  const state = loadProjectState(project, { root: project.root, now, fresh: true })
  const messages = messageList(project.id, 200, channelDir)
  const { findings } = completeAudit(state, { project, messages, lessons: recentLessons(200), now })
  const goal = formatGoal(projectGoal(state, { laneOrder: [...Object.keys(project.lanes ?? {}), 'U'] }))
  const channelMessages = messageList(project.id, limit, channelDir)
  const channel = [CHANNEL_HEADER, ...(channelMessages.length ? channelMessages.map(fmtMessage) : ['(no messages yet)'])].join('\n')
  const byCode = code => findings.filter(f => f.code === code)
  const doneElsewhere = byCode('done-elsewhere')
  const ghosts = byCode('ghost')
  const stale = byCode('stale-claim')
  const unblocked = findings.filter(f => f.code === 'unblocked')
  const rippleReady = byCode('ripple-ready')
  const noProof = byCode('no-proof')
  const noPlain = byCode('no-plain')
  const noGate = byCode('no-gate')
  const proseDep = byCode('prose-dep')
  const fix = findings.filter(f => f.level === 'fix')
  const wtDirs = state.worktrees.porcelain.split(/\r?\n\r?\n/).map(b => b.match(/^worktree (.+)$/m)?.[1]).filter(Boolean)
  const status = state.statusRaw
  return {
    project: project.id, root: project.root, goal, channel, worktrees: state.worktrees.porcelain,
    status, findings,
    counts: {
      fix: fix.length, doneElsewhere: doneElsewhere.length, ghosts: ghosts.length, stale: stale.length,
      unblocked: unblocked.length, rippleReady: rippleReady.length, noProof: noProof.length,
      noPlain: noPlain.length, noGate: noGate.length, proseDep: proseDep.length,
      worktrees: wtDirs.length, dirty: status ? status.split('\n').length : 0,
    },
    lists: { doneElsewhere, ghosts, stale, unblocked, rippleReady, fix },
    nudges: buildNudges({ findings, messages: messageListForNudges(project.id, channelDir), nudgeAfterHours: nudgeAfter }),
    channelDir,
  }
}

function messageListForNudges (project, dir) {
  return [...readChannel(project, { limit: 50, dir }), ...readChannel('all', { limit: 50, dir })]
}

function digestText (s) {
  const c = s.counts
  const bits = []
  if (c.doneElsewhere) bits.push(`${c.doneElsewhere} done-not-merged`)
  if (c.ghosts) bits.push(`${c.ghosts} ghost-only`)
  if (c.unblocked) bits.push(`${c.unblocked} unblocked`)
  if (c.stale) bits.push(`${c.stale} stale-claim`)
  if (c.fix) bits.push(`${c.fix} fix`)
  if (c.rippleReady) bits.push(`${c.rippleReady} ripple-ready`)
  const head = bits.length ? bits.join(', ') : 'clean'
  let text = `maintainer sweep: ${s.project} ${head}. `
  const ids = s.lists.doneElsewhere.slice(0, 6).map(f => f.id).filter(Boolean)
  if (ids.length) text += `Merge queue: ${ids.join(', ')}. `
  const gh = s.lists.ghosts.slice(0, 4).map(f => f.id).filter(Boolean)
  if (gh.length) text += `Ghost: ${gh.join(', ')}. `
  if (s.counts.dirty) text += `Main checkout dirty (${s.counts.dirty} paths). `
  text += 'Details in audit; integrator decides merges.'
  return text.slice(0, 590)
}

export function runSweep ({ args = [], projects = loadProjects(), now = Date.now(), channelDir = CHANNEL_DIR, postMessage = post } = {}) {
  if (args.includes('--help') || args.includes('-h')) return { output: `maintainer sweep: read-only status across all VN ports, plus optional channel posts.

  node maintainer-sweep.mjs [--project <id|all>] [--limit N] [--post] [--by "<agent>"] [--nudge-after H]
  npm run maintainer-sweep -- [--project all] [--post --by "maintainer spark"]

Dry run by default (no posts). --post writes one short digest per project to the agent channel.
--post also sends one polite progress question for each stale claim that has not already been nudged.`, errors: [], exitCode: 0 }
  const projectFilter = String(option(args, '--project', 'all')).toLowerCase()
  const doPost = args.includes('--post')
  const by = String(option(args, '--by', 'maintainer spark'))
  const limit = Number(option(args, '--limit', 30)) || 30
  const nudgeAfter = Number(option(args, '--nudge-after', NUDGE_AFTER_HOURS)) || NUDGE_AFTER_HOURS
  const selected = projects.filter(p => projectFilter === 'all' || p.id === projectFilter)
  if (!selected.length) return { output: '', errors: [`unknown --project ${projectFilter} (known: ${projects.map(p => p.id).join(', ')}, all)`], exitCode: 1 }

  const output = []
  const errors = []
  let failed = 0
  for (const project of selected) {
    if (!project.root) {
      output.push('', `=== ${project.id} ===`, 'error: project checkout is unavailable')
      failed++
      continue
    }
    if (!existsSync(join(project.root, 'docs', 'BACKLOG.md'))) {
      output.push('', `=== ${project.id} ===`, 'error: docs/BACKLOG.md is unavailable')
      failed++
      continue
    }
    let summary
    try { summary = summarize(project, { limit, nudgeAfter, now, channelDir }) } catch (error) {
      output.push(`\n=== ${project.id} ===`, `error: ${error?.message ?? 'project snapshot failed'}`)
      failed++
      continue
    }
    const s = summary
    output.push('', `=== ${s.project} ===`, ...s.goal.split('\n').slice(0, 14), '',
      `audit: ${s.findings.length} findings (${s.counts.fix} fix, ${s.counts.doneElsewhere} done-elsewhere, ${s.counts.ghosts} ghost, ${s.counts.stale} stale-claim, ${s.counts.unblocked} unblocked)`)
    for (const f of s.findings.slice(0, 25)) {
      output.push(`  ${f.level} ${f.id ?? ''} ${f.text}`.trimEnd())
      if (f.suggest) output.push(`    suggest: ${f.suggest}`)
    }
    if (s.findings.length > 25) output.push(`  ... +${s.findings.length - 25} more (run npm run issue -- audit)`)
    output.push('', `worktrees: ${s.counts.worktrees} other, main dirty paths: ${s.counts.dirty}`)
    if (s.status) output.push(...s.status.split('\n').slice(0, 10))
    output.push('', `recent channel (last ${limit}):`, ...s.channel.split('\n').slice(0, 20))
    for (const n of s.nudges) output.push('', `${doPost ? 'nudging' : 'would nudge'} ${n.id} (${n.staleHours}h, ${n.owner}): ${n.text}`)

    const postOne = (text, { kind, ticket } = {}) => {
      try {
        const msg = postMessage({ channel: s.project, by, kind, ticket, text }, { dir: channelDir, now })
        output.push('', `posted to #${s.project}: ${fmtMessage(msg)}`)
      } catch (error) {
        errors.push(`post to #${s.project} failed: ${error?.message ?? 'channel write failed'}`)
        failed++
      }
    }
    if (doPost) {
      postOne(digestText(s), { kind: 'heads-up' })
      for (const n of s.nudges) postOne(n.text, { kind: n.kind, ticket: n.id })
    }
  }
  if (!doPost) output.push('', 'Dry run (no posts). Add --post --by "maintainer spark" to post one digest per project.')
  return { output: output.join('\n'), errors, exitCode: failed ? 1 : 0 }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const result = runSweep({ args: process.argv.slice(2) })
  if (result.output) console.log(result.output)
  for (const error of result.errors) console.error(error)
  process.exitCode = result.exitCode
}
