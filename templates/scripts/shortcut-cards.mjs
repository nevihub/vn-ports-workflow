// One card per `shortcut:` comment in src/: the guess, its native addresses, every local evidence file that already
// mentions those addresses, cached native-query results and the checklist items it feeds. Read a card before
// starting RE on a shortcut (the answer is often already on disk). Output: re/cards/INDEX.md + one .md per card.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { root } from './lib/automation.mjs'

if (process.argv.slice(2).some(a => a === '--help' || a === '-h')) { console.log('Usage: node scripts/shortcut-cards.mjs'); process.exit(0) }

const slash = p => p.split('\\').join('/')
const walk = dir => existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]) : []
const ADDR = /\b0x(?:4|5)[0-9a-f]{5}\b|\bFUN_00([0-9a-f]{6})\b/gi
const addrsIn = text => [...new Set([...text.matchAll(ADDR)].map(m => m[1] ? `0x${m[1]}`.toLowerCase() : m[0].toLowerCase()))]

// Path A: our own scan of src/.
const shortcuts = []
for (const file of walk(join(root, 'src')).filter(f => /\.(ts|css|html)$/.test(f))) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!line.includes('shortcut:')) return
    const context = lines.slice(Math.max(0, i - 4), i + 2).join('\n')
    shortcuts.push({ file: slash(relative(root, file)), line: i + 1, text: line.slice(line.indexOf('shortcut:') + 9).trim(), addrs: addrsIn(context) })
  })
}
// Path B: git grep; the two counts must agree or the cards are not trusted.
const grepCount = execFileSync('git', ['grep', '-c', 'shortcut:', '--', 'src'], { cwd: root, encoding: 'utf8' }).trim().split('\n')
  .reduce((n, l) => n + Number(l.split(':').pop()), 0)
const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'src'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
const untrackedCount = untracked.reduce((n, f) => n + (readFileSync(join(root, f), 'utf8').match(/shortcut:/g)?.length ?? 0), 0)
if (grepCount + untrackedCount !== shortcuts.length) {
  console.error(`Card scan found ${shortcuts.length} shortcuts but git grep found ${grepCount + untrackedCount}; refusing to write cards.`)
  process.exit(1)
}

const evidenceFiles = [...walk(join(root, 're/verification')), ...walk(join(root, 'docs')), join(root, 'HANDOFF.md')]
  .filter(f => /\.(md|asm|c|txt)$/.test(f))
const corpus = evidenceFiles.map(f => ({ path: slash(relative(root, f)), text: readFileSync(f, 'utf8').toLowerCase() }))
const cached = new Set(walk(join(root, 're/scratch/native-query/cache')).flatMap(f => {
  try { const j = JSON.parse(readFileSync(f, 'utf8')); return [String(j.procedure ?? j.parameters?.procedure ?? '').toLowerCase()] } catch { return [] }
}))
const checklist = JSON.parse(readFileSync(join(root, 'docs/progress-checklist.json'), 'utf8')).items

const outDir = join(root, 're/cards')
await rm(outDir, { recursive: true, force: true })
await mkdir(outDir, { recursive: true })
const index = []
for (const s of shortcuts) {
  const name = `${s.file.replace(/^src\//, '').replace(/[/.]/g, '-')}-${s.line}`
  const base = s.file.split('/').pop()
  const items = checklist.filter(i => i.id === 'fid.shortcuts' || (i.evidence ?? '').includes(base) || s.addrs.some(a => (i.evidence ?? '').toLowerCase().includes(a)))
  const evidence = s.addrs.map(a => ({ a, cached: cached.has(a), files: corpus.filter(c => c.text.includes(a) || c.text.includes(`fun_00${a.slice(2)}`)).map(c => c.path) }))
  const known = evidence.some(e => e.files.length || e.cached)
  const body = [`# ${s.file}:${s.line}`, '', `Guess: ${s.text}`, '',
    `Addresses: ${s.addrs.join(', ') || 'none named — find an entry point first (strings, xrefs to the variable or builtin name)'}`, '',
    '## Evidence already on disk', ...(evidence.length ? evidence.map(e => `- ${e.a}${e.cached ? ' (native-query cached)' : ''}: ${e.files.join(', ') || 'no mentions'}`) : ['- none']), '',
    '## Checklist items', ...items.map(i => `- ${i.id} (${i.status}${i.partial ? ` ${i.partial}` : ''}): ${i.title}`), '',
    '## Next step', known ? 'Read the evidence files above first; only query new addresses.'
      : 'No local evidence: disassemble with `python -I tools/x86dis.py <exe> ...` or `npm run native-query`, then record the result.', '']
  await writeFile(join(outDir, `${name}.md`), body.join('\n'))
  index.push(`| [${s.file}:${s.line}](${name}.md) | ${s.addrs.join(' ') || '–'} | ${known ? 'yes' : 'no'} | ${items.filter(i => i.id !== 'fid.shortcuts').map(i => i.id).join(' ') || '–'} |`)
}
await writeFile(join(outDir, 'INDEX.md'), [`# Shortcut cards (${shortcuts.length}, generated ${new Date().toISOString()})`, '',
  '| shortcut | addresses | evidence on disk | checklist |', '|---|---|---|---|', ...index, ''].join('\n'))
console.log(`Cards ${shortcuts.length} (git grep agrees) | ${index.filter(r => r.includes('| yes |')).length} with evidence on disk | re/cards/INDEX.md`)
