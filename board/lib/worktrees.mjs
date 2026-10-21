// Other checkouts (git worktrees) of a project and its recent commit times - read-only, cached 15 s. Worktrees often
// live outside VN-Ports (~/.codex/worktrees, ~/.local/share/opencode/worktree), so everything goes through git.
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { evictParsedLedger, parsedLedger } from './ledger-cache.mjs'

const norm = p => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const cache = new Map()
const ledgerPaths = new Map()

const refreshSources = sources => sources.map(source => {
  const ledger = parsedLedger(source.ledgerPath)
  return { ...source, md: ledger.md, items: ledger.items }
})

const updateLedgerIndex = (rootKey, sources) => {
  const next = new Set(sources.map(s => resolve(s.ledgerPath)))
  for (const old of ledgerPaths.get(rootKey) ?? []) if (!next.has(old)) evictParsedLedger(old)
  ledgerPaths.set(rootKey, next)
}

export function worktrees (root, { maxAgeMs = 15000, now = Date.now() } = {}) {
  const rootKey = norm(resolve(root))
  const hit = cache.get(rootKey)
  if (hit && now - hit.at < maxAgeMs) return { ...hit, sources: refreshSources(hit.sources) }
  let porcelain = ''
  try { porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }) } catch {}
  const commits = new Map()
  try {
    const log = execFileSync('git', ['log', '-n', '400', '--format=%h\t%cI'], { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    for (const line of log.split('\n')) {
      const [h, iso] = line.trim().split('\t')
      if (h && iso) commits.set(h, Date.parse(iso))
    }
  } catch {}
  const sources = []
  for (const block of porcelain.split(/\r?\n\r?\n/)) {
    const dir = block.match(/^worktree (.+)$/m)?.[1]?.trim()
    if (!dir || norm(dir) === norm(root)) continue
    if (/^prunable /m.test(block)) continue
    const branch = block.match(/^branch (.+)$/m)?.[1]?.trim().replace(/^refs\/heads\//, '') ?? null
    // A worktree named like the main folder (~/.codex/worktrees/e8-hub-hover/Subahibi) is called by its parent.
    const parts = dir.split('/').filter(Boolean)
    const name = parts.length > 1 && norm(parts.at(-1)) === norm(root).split('/').pop() ? parts.at(-2) : parts.at(-1)
    const ledgerPath = join(dir, 'docs', 'BACKLOG.md')
    sources.push({ name, dir, branch, ledgerPath, md: null, items: null })
  }
  updateLedgerIndex(rootKey, sources)
  const res = { at: now, porcelain, sources: refreshSources(sources), commits }
  cache.set(rootKey, res)
  return res
}
