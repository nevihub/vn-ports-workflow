// Proof freshness: for every auto-proof item in docs/progress-checklist.json, find the proof the progress report
// would use (newest *.json with a boolean ok) and say whether the engine source changed after it was captured.
// Two independent paths: the recorded git commit, and file mtimes (src/, index.html, public/ vs the proof).
// --strict exits 1 when any passing proof is stale or untraceable.
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { root, writeProof } from './lib/automation.mjs'

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) { console.log('Usage: node scripts/check-proofs.mjs [--strict]'); process.exit(0) }

const slash = p => p.split('\\').join('/')
const git = a => { try { return execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
const globRe = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*') + '$')

const SOURCE = ['src', 'index.html', 'public'].map(p => join(root, p))
const sourceFiles = SOURCE.flatMap(p => { try { return statSync(p).isDirectory() ? walk(p) : [p] } catch { return [] } })
  .filter(p => !slash(p).includes('/public/game/'))
const head = git(['rev-parse', '--short', 'HEAD'])
const evidence = walk(join(root, 're/verification')).map(p => slash(relative(root, p))).filter(p => p.endsWith('.json') && !p.endsWith('.progress.json'))
const checklist = JSON.parse(readFileSync(join(root, 'docs/progress-checklist.json'), 'utf8'))

const commitOf = proof => {
  const label = typeof proof.commit === 'string' ? proof.commit
    : typeof proof.checkpoint?.head === 'string' ? proof.checkpoint.head + (proof.checkpoint.dirty ? '-dirty' : '')
    : typeof proof.source?.head === 'string' ? proof.source.head + (proof.source.dirty ? '-dirty' : '') : null
  const m = label && /^([0-9a-f]{7,40})(-dirty)?$/.exec(label)
  return m ? { sha: m[1], dirty: !!m[2] } : null
}

const rows = []
for (const item of checklist.items.filter(i => i.auto?.proof)) {
  const re = globRe(item.auto.proof)
  const candidates = evidence.filter(p => re.test(p)).map(p => {
    try { const proof = JSON.parse(readFileSync(join(root, p), 'utf8')); return typeof proof?.[item.auto.field ?? 'ok'] === 'boolean' ? { p, proof, mtime: statSync(join(root, p)).mtimeMs } : null } catch { return null }
  }).filter(Boolean).sort((a, b) => b.mtime - a.mtime)
  const pick = candidates[0]
  if (!pick) { rows.push({ id: item.id, state: 'missing' }); continue }
  const ok = pick.proof[item.auto.field ?? 'ok'] === true
  const newer = sourceFiles.filter(f => statSync(f).mtimeMs > pick.mtime).map(f => slash(relative(root, f)))
  const c = commitOf(pick.proof)
  const known = c && git(['cat-file', '-e', `${c.sha}^{commit}`]) !== null
  const since = known ? Number(git(['rev-list', '--count', `${c.sha}..HEAD`])) : null
  const changed = known ? (git(['diff', '--name-only', c.sha, 'HEAD', '--', 'src', 'index.html', 'public']) || '').split('\n').filter(Boolean).length : null
  // Fresh only when both paths agree: no source file newer than the proof, and no committed source change since its
  // commit. A dirty-tree proof can only be dated by mtime, so it is labelled fresh-worktree.
  const state = !c || !known ? 'untraceable' : newer.length ? 'stale' : c.dirty ? 'fresh-worktree' : changed ? 'stale' : 'fresh'
  rows.push({ id: item.id, proof: pick.p, ok, state, commit: c ? c.sha + (c.dirty ? '-dirty' : '') : null,
    commitsSince: since, sourceFilesChangedSinceCommit: changed, sourceFilesNewerThanProof: newer.length, newerExamples: newer.slice(0, 3) })
}

const count = s => rows.filter(r => r.state === s).length
const bad = rows.filter(r => r.ok && !r.state.startsWith('fresh'))
await writeProof('re/verification/proof-freshness.json', { createdAt: new Date().toISOString(), head, items: rows.length, rows })
for (const r of rows.filter(r => !r.state.startsWith('fresh'))) console.log(`  ${r.state.padEnd(11)} ${r.id}${r.proof ? ` (${r.ok ? 'pass' : 'FAIL'}, ${r.commit ?? 'no commit'}, ${r.sourceFilesNewerThanProof} newer src files)` : ''}`)
console.log(`Proofs ${rows.length} auto items @${head}: ${count('fresh')} fresh, ${count('fresh-worktree')} fresh-worktree, ${count('stale')} stale, ${count('untraceable')} untraceable, ${count('missing')} missing | proof re/verification/proof-freshness.json`)
if (args.has('--strict') && bad.length) process.exit(1)
