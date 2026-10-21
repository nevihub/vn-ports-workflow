#!/usr/bin/env node
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadProjects } from './lib/projects.mjs'
import { readCleanupManifest, runWorktreeCleanup } from './lib/worktree-clean.mjs'

const BOARD = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log('worktree-clean: inventory-only by default. Read worktree-clean.md and worktree-clean.json before adding candidates.\n' +
    'Eligibility requires explicit ticket associations, DONE tickets, no conflicting claims/recovery, merged HEAD,\n' +
    'clean tracked/untracked/ignored state, no submodules, a valid unlocked non-primary checkout, and fresh\n' +
    'inactive-owner, no-active-job, non-app-managed, and non-pinned attestations. Every uncertain case is refused.\n' +
    'Use --apply to remove eligible registered worktrees. Use --apply --prune only for exact, verified stale metadata.\n' +
    'The command uses non-forced Git worktree removal and never deletes branches or falls back to filesystem deletion.')
  process.exit(0)
}
const unknown = args.filter(arg => !['--apply', '--prune'].includes(arg))
if (unknown.length) {
  console.error(`unknown option: ${unknown[0]}`)
  process.exit(2)
}
const result = runWorktreeCleanup({ manifest: readCleanupManifest(join(BOARD, 'worktree-clean.json')),
  projects: loadProjects(), boardRoot: BOARD, apply: args.includes('--apply'), prune: args.includes('--prune') })
for (const line of result.output) console.log(line)
for (const error of result.errors) console.error(error)
process.exitCode = result.exitCode
