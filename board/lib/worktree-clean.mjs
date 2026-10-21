import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { parse } from './ledger.mjs'
import { parsedLedger } from './ledger-cache.mjs'

const run = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const norm = path => resolve(path).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const existsDirectory = path => { try { return statSync(path).isDirectory() } catch { return false } }
const blocks = text => text.split(/\r?\n\r?\n/).filter(Boolean).map(block => {
  const field = name => block.match(new RegExp(`^${name} (.*)$`, 'm'))?.[1] ?? null
  return { path: field('worktree'), head: field('HEAD'), branch: field('branch')?.replace(/^refs\/heads\//, '') ?? null,
    locked: /^locked(?: |$)/m.test(block), prunable: /^prunable(?: |$)/m.test(block), raw: block }
})
const commonDir = path => resolve(path, run(path, ['rev-parse', '--git-common-dir']))
const parseLedger = path => {
  const result = parsedLedger(join(path, 'docs', 'BACKLOG.md'))
  return result.md === null ? null : result.items
}
export const hasNestedRepository = root => {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return true }
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (norm(dir) !== norm(root) && entry.name.toLowerCase() === '.git') return true
      if (entry.isDirectory() && !entry.isSymbolicLink()) stack.push(child)
    }
  }
  return false
}
export const isAppManagedPath = path => {
  const p = norm(path)
  const roots = [join(homedir(), '.codex', 'worktrees'), join(homedir(), '.local', 'share', 'opencode', 'worktree'), join(homedir(), '.local', 'share', 'opencode', 'worktrees')].map(norm)
  return roots.some(root => p === root || p.startsWith(`${root}/`))
}
const checkedRecently = (value, maxAgeMs, now = Date.now()) => {
  if (typeof value !== 'string') return false
  const at = Date.parse(value)
  return Number.isFinite(at) && at <= now && now - at <= maxAgeMs
}
const inactiveAttestationReasons = (candidate, now = Date.now()) => {
  const reasons = []
  if (candidate?.ownerState !== 'verified-inactive' || !checkedRecently(candidate?.ownerCheckedAt, 15 * 60_000, now)) {
    reasons.push('owner inactivity is unverified or older than 15 minutes')
  }
  if (!Array.isArray(candidate?.activeJobs) || candidate.activeJobs.length !== 0 || !checkedRecently(candidate?.activeJobsCheckedAt, 2 * 60_000, now)) {
    reasons.push('no-active-job attestation is missing, nonempty, or older than 2 minutes')
  }
  if (candidate?.appManaged !== false) reasons.push('app-managed status is positive or unverified; use the app lifecycle tool')
  if (candidate?.pinned !== false) reasons.push('pinned status is positive or unverified')
  if (!checkedRecently(candidate?.checkoutClassificationCheckedAt, 15 * 60_000, now)) {
    reasons.push('app-managed/pinned classification is unverified or older than 15 minutes')
  }
  return reasons
}
const confirmedInactive = (candidate, now = Date.now()) => inactiveAttestationReasons(candidate, now).length === 0

export function resolveRepositoryRoot (repository, projects, boardRoot) {
  if (typeof repository.root !== 'string') return null
  if (repository.root.startsWith('project:')) return projects.find(p => p.id === repository.root.slice(8))?.root ?? null
  return isAbsolute(repository.root) ? resolve(repository.root) : resolve(boardRoot, repository.root)
}

function gitReadiness (root, path) {
  const reasons = []
  let candidateRoot
  let actualRoot
  let mainCommon
  let candidateCommon
  try {
    candidateRoot = realpathSync.native(path)
    actualRoot = realpathSync.native(run(path, ['rev-parse', '--show-toplevel']))
    if (norm(actualRoot) !== norm(candidateRoot)) reasons.push('path is not the root of its registered checkout')
    mainCommon = commonDir(root)
    candidateCommon = commonDir(path)
    if (norm(mainCommon) !== norm(candidateCommon)) reasons.push('checkout belongs to a different repository')
  } catch {
    reasons.push('Git could not verify checkout identity')
    return { reasons, candidateRoot: null }
  }
  return { reasons, candidateRoot }
}

function ledgerConflicts (ledgerRoot, ticketIds, worktreeRows, inventoryError = false) {
  const main = parseLedger(ledgerRoot)
  if (!main) return ['integration checkout ledger is missing or unreadable']
  const mainById = new Map(main.map(item => [item.id, item]))
  const conflicts = inventoryError ? ['ticket-ledger worktree inventory failed'] : []
  for (const id of ticketIds) {
    const item = mainById.get(id)
    if (!item) conflicts.push(`${id} is absent from the integration ledger`)
    else if (item.state !== 'done') conflicts.push(`${id} is ${item.state.toUpperCase()} in the integration ledger`)
  }
  const ids = new Set(ticketIds)
  const allRows = new Map(worktreeRows.filter(row => row.path).map(row => [norm(row.path), row]))
  for (const row of allRows.values()) {
    if (row.prunable || !existsDirectory(row.path)) continue
    const items = parseLedger(row.path)
    if (!items) { conflicts.push('ticket ledger is missing or unreadable in a relevant checkout'); continue }
    for (const item of items) {
      if (!ids.has(item.id)) continue
      if (item.state === 'claimed') conflicts.push(`${item.id} has an active claim in another checkout`)
      if (item.state === 'blocked') conflicts.push(`${item.id} has active recovery work in another checkout`)
    }
  }
  return [...new Set(conflicts)]
}

function candidateCheck ({ root, ledgerRoot, repository, candidate, projects, boardRoot, rows, ledgerRows, ledgerInventoryError = false, integrationRef = null }) {
  const reasons = []
  const rawPath = candidate?.path
  if (!isAbsolute(String(rawPath ?? ''))) reasons.push('manifest candidate path is not absolute')
  if (!Array.isArray(candidate?.tickets) || candidate.tickets.length === 0 || candidate.tickets.some(id => !/^[A-Z]{1,2}\d+$/.test(id))) {
    reasons.push('manifest needs explicit candidate-to-ticket associations')
  }
  if (!repository.ledgerProject || !ledgerRoot) reasons.push('ticket ledger repository mapping is unavailable')
  reasons.push(...inactiveAttestationReasons(candidate))
  if (!root || !existsDirectory(root)) reasons.push('repository root is unavailable')
  if (reasons.length) return { eligible: false, reasons }

  const path = resolve(rawPath)
  const row = rows.find(x => norm(x.path) === norm(path))
  if (!row) reasons.push('path is not a registered worktree')
  else if (row.prunable || !existsDirectory(path)) reasons.push('checkout is unavailable or marked prunable; it remains untouched until separately verified abandoned')
  else {
    if (norm(path) === norm(root)) reasons.push('primary checkout cannot be removed')
    if (row.locked) reasons.push('worktree is locked')
    if (isAppManagedPath(path)) reasons.push('path is under an app-managed worktree directory; use that app lifecycle tool')
    const identity = gitReadiness(root, path)
    reasons.push(...identity.reasons)
    try {
      if (identity.candidateRoot && norm(identity.candidateRoot) === norm(realpathSync.native(root))) reasons.push('primary checkout cannot be removed')
    } catch { reasons.push('Git could not verify the primary checkout path') }
    if (!integrationRef) reasons.push(`integration branch ${repository.integrationBranch} is unavailable`)
    else {
      let head = ''
      try { head = run(path, ['rev-parse', 'HEAD']) } catch { reasons.push('Git could not read checkout HEAD') }
      if (head) {
        try { run(root, ['merge-base', '--is-ancestor', head, integrationRef]) } catch { reasons.push('checkout HEAD is not an ancestor of the integration branch') }
      }
    }

    let status = null
    try { status = run(path, ['status', '--porcelain', '--untracked-files=all', '--ignored=matching']) } catch { reasons.push('Git could not verify tracked, untracked, and ignored files') }
    if (status !== null) {
      const entries = status.split(/\r?\n/).filter(Boolean)
      const ignored = entries.filter(line => line.startsWith('!!')).length
      const untracked = entries.filter(line => line.startsWith('??')).length
      const tracked = entries.length - ignored - untracked
      if (tracked) reasons.push('tracked changes are present')
      if (untracked) reasons.push('untracked files are present')
      if (ignored) reasons.push('ignored files are present')
      if (!entries.length && hasNestedRepository(path)) reasons.push('an embedded repository or nested worktree is present')
    }
    try {
      const staged = run(path, ['ls-files', '--stage'])
      if (/^160000\s/m.test(staged) || existsSync(join(path, '.gitmodules'))) reasons.push('submodules or embedded repository links are present')
    } catch { reasons.push('Git could not verify submodules or embedded repositories') }
  }
  if (ledgerRoot && Array.isArray(candidate.tickets)) reasons.push(...ledgerConflicts(ledgerRoot, candidate.tickets, ledgerRows ?? [], ledgerInventoryError))
  return { eligible: reasons.length === 0, reasons, path }
}

export function inspectRepository (repository, projects, boardRoot) {
  const root = resolveRepositoryRoot(repository, projects, boardRoot)
  if (!root || !existsDirectory(root)) return { repository: repository.id, root, rows: [], candidates: [], error: 'repository root is unavailable' }
  let rows
  try { rows = blocks(run(root, ['worktree', 'list', '--porcelain'])) } catch { return { repository: repository.id, root, rows: [], candidates: [], error: 'Git worktree inventory failed' } }
  let integrationRef = null
  try {
    if (!/^[A-Za-z0-9._/-]+$/.test(repository.integrationBranch)) throw Error('invalid branch')
    integrationRef = run(root, ['rev-parse', '--verify', `refs/heads/${repository.integrationBranch}^{commit}`])
  } catch {}
  const ledgerRoot = projects.find(p => p.id === repository.ledgerProject)?.root ?? null
  let ledgerRows = []
  let ledgerInventoryError = false
  if (ledgerRoot && existsDirectory(ledgerRoot)) {
    try { ledgerRows = blocks(run(ledgerRoot, ['worktree', 'list', '--porcelain'])) } catch { ledgerInventoryError = true }
  } else {
    ledgerInventoryError = true
  }
  const entries = Array.isArray(repository.candidates) ? repository.candidates : []
  const candidates = entries.map(candidate => ({ candidate, ...candidateCheck({ root, ledgerRoot, repository, candidate, projects, boardRoot, rows, ledgerRows, ledgerInventoryError, integrationRef }) }))
  const inventory = rows.map(row => {
    const candidate = entries.find(entry => norm(entry.path ?? '') === norm(row.path ?? ''))
    if (candidate) return { ...row, candidate, result: candidates.find(item => item.candidate === candidate) }
    const primary = norm(row.path ?? '') === norm(root)
    return { ...row, result: { eligible: false, reasons: [primary ? 'primary checkout cannot be removed' : row.prunable || !existsDirectory(row.path) ? 'unavailable worktree; pruning requires explicit abandonment verification' : 'no explicit candidate-to-ticket association in the cleanup manifest'] } }
  })
  for (const entry of entries) if (!rows.some(row => norm(row.path ?? '') === norm(entry.path ?? ''))) {
    inventory.push({ path: entry.path, candidate: entry, result: candidates.find(item => item.candidate === entry) })
  }
  return { repository: repository.id, root, ledgerRoot, ledgerRows, rows: inventory, candidates, integrationRef }
}

export function runWorktreeCleanup ({ manifest, projects, boardRoot, apply = false, prune = false, afterInspect = null, executeGit = run } = {}) {
  const output = []
  const errors = []
  if (prune && !apply) return { output: [], errors: ['--prune requires --apply'], exitCode: 2, removed: [] }
  const removed = []
  for (const repository of manifest.repositories ?? []) {
    const report = inspectRepository(repository, projects, boardRoot)
    output.push(`\n${report.repository}: ${report.error ?? `${report.rows.length} registered checkout(s)`}`)
    if (report.error) { errors.push(`${report.repository}: ${report.error}`); continue }
    for (const row of report.rows) {
      const label = row.path ?? '(unknown path)'
      const reasons = row.result?.reasons ?? ['checkout could not be inspected']
      if (!row.result?.eligible) output.push(`REFUSED ${label}: ${reasons.join('; ')}`)
      else if (!apply) output.push(`ELIGIBLE ${label}: all checks passed; dry run only`)
      else {
        let check
        try {
          afterInspect?.({ repository, candidate: row.candidate, path: row.path })
          const freshRows = blocks(executeGit(report.root, ['worktree', 'list', '--porcelain']))
          const freshLedgerRows = report.ledgerRoot ? blocks(executeGit(report.ledgerRoot, ['worktree', 'list', '--porcelain'])) : []
          let freshIntegrationRef = null
          try { freshIntegrationRef = executeGit(report.root, ['rev-parse', '--verify', `refs/heads/${repository.integrationBranch}^{commit}`]) } catch {}
          check = candidateCheck({ root: report.root, ledgerRoot: report.ledgerRoot, repository, candidate: row.candidate, projects, boardRoot,
            rows: freshRows, ledgerRows: freshLedgerRows, ledgerInventoryError: false, integrationRef: freshIntegrationRef })
        } catch (error) {
          output.push(`REFUSED ${label}: final Git eligibility recheck failed (${error?.code ?? 'error'}); checkout left untouched; no filesystem fallback was used`)
          continue
        }
        if (!check.eligible) { output.push(`REFUSED ${label}: eligibility changed before removal: ${check.reasons.join('; ')}`); continue }
        try {
          executeGit(report.root, ['worktree', 'remove', resolve(row.path)])
          output.push(`REMOVED ${label}`)
          removed.push(row.path)
        } catch (error) {
          output.push(`REFUSED ${label}: non-forced Git worktree removal failed (${error?.code ?? 'error'}); checkout left untouched; no filesystem fallback was used`)
        }
      }
    }
    if (prune) {
      const requested = Array.isArray(repository.prune) ? repository.prune : []
      if (!requested.length) output.push('prune: no explicitly confirmed abandoned worktrees; no pruning performed')
      else {
        let preview = ''
        let pruneRows = []
        try {
          pruneRows = blocks(executeGit(report.root, ['worktree', 'list', '--porcelain']))
          preview = executeGit(report.root, ['worktree', 'prune', '--dry-run', '--verbose'])
        } catch {
          output.push('prune: Git preview failed; no pruning performed')
          continue
        }
        const abandoned = pruneRows.filter(row => row.prunable || !existsDirectory(row.path))
        const listed = new Set(abandoned.map(row => norm(row.path)))
        const confirmed = new Set(requested.filter(entry => isAbsolute(String(entry.path ?? '')) && confirmedInactive(entry)).map(entry => norm(entry.path)))
        const allConfirmed = abandoned.length > 0 && listed.size === confirmed.size && [...listed].every(path => confirmed.has(path))
        if (!allConfirmed || (preview === '' && abandoned.length > 0)) {
          output.push('prune: Git found an unavailable entry without matching explicit abandonment verification; no pruning performed')
        } else {
          try { executeGit(report.root, ['worktree', 'prune', '--expire', 'now']); output.push('prune: confirmed abandoned metadata pruned') } catch { output.push('prune: Git pruning failed; no filesystem cleanup was used') }
        }
      }
    }
  }
  if (!apply) output.unshift('Inventory only. Pass --apply to remove eligible registered worktrees.')
  return { output, errors, exitCode: errors.length ? 1 : 0, removed }
}

export function readCleanupManifest (path) { return JSON.parse(readFileSync(path, 'utf8')) }
