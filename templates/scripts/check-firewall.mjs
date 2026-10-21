// Content firewall: fails when a file git would commit carries game content.
// Checks tracked + staged + untracked-not-ignored files for forbidden paths/extensions, oversized blobs and
// story text. The text check derives its forbidden set from the local <PRE> blocks (8-token shingles) and
// proves itself on an in-memory planted fixture before it is trusted. Matched text is never printed.
// Sizes and story-text bytes come from the STAGED blob for tracked files (what a commit would record)
// and from the worktree for untracked ones, so staged/worktree skew cannot hide a blob.
// Known limit: heuristics plus corpus shingles cannot mathematically prove that no copyrighted
// content is present; they prove the known game shapes are absent.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { root, writeProof } from './lib/automation.mjs'

const usage = 'Usage: node scripts/check-firewall.mjs [--help]'
if (process.argv.slice(2).some(a => a === '--help' || a === '-h')) { console.log(usage); process.exit(0) }

const FORBIDDEN_EXT = /\.(npa|nss|exe|dll|ogg|wav|mp3|m4a|aac|jpg|jpeg|png|bmp|webp|gif|mpg|mpeg|avi|wmv|ttf|otf)$/i
const FORBIDDEN_DIR = /^(public\/game|game-data|dist|ref|re)\//
const MAX_BYTES = 2 * 1024 * 1024, SIZE_EXEMPT = new Set(['package-lock.json'])
const K = 8

const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 })
const tracked = new Set(git(['ls-files', '-z', '--cached']).split('\0').filter(Boolean))
const stagedBytes = file => {
  try { return execFileSync('git', ['cat-file', 'blob', ':0:' + file], { cwd: root, encoding: 'buffer', maxBuffer: 256 << 20 }) } catch { return null }
}
const stagedSize = file => {
  try {
    const n = Number(execFileSync('git', ['cat-file', '-s', ':0:' + file], { cwd: root, encoding: 'utf8' }).trim())
    return Number.isFinite(n) ? n : null
  } catch { return null }
}
const files = [...new Set([...git(['ls-files', '-z', '--cached']).split('\0'),
  ...git(['ls-files', '-z', '--others', '--exclude-standard']).split('\0')].filter(Boolean))].sort()

// Tokens: lowercase ASCII words, or single CJK/kana/full-width characters.
const tokens = text => {
  const out = []
  for (const m of text.toLowerCase().matchAll(/[a-z0-9]+|[぀-ヿ㐀-鿿！-～]/g)) out.push([m[0], m.index])
  return out
}
const shingles = toks => { const s = []; for (let i = 0; i + K <= toks.length; i++) s.push(toks.slice(i, i + K).map(t => t[0]).join(' ')); return s }

function loadStoryText() {
  const utf8 = join(root, 'game-data/nss-utf8'), raw = join(root, 'game-data/nss')
  const dir = existsSync(utf8) ? utf8 : existsSync(raw) ? raw : null
  if (!dir) return null
  const decoder = new TextDecoder(dir === utf8 ? 'utf-8' : 'shift_jis')
  const blocks = []
  let opens = 0, closes = 0
  for (const name of readdirSync(dir).filter(n => /\.nss$/i.test(n))) {
    const text = decoder.decode(readFileSync(join(dir, name)))
    // Outermost <PRE> spans only: inline <PRE></PRE> inside a story block must not cut the block short.
    let depth = 0, start = 0
    for (const m of text.matchAll(/<(\/?)PRE\b[^>]*>/gi)) {
      if (!m[1]) { opens++; if (depth++ === 0) start = m.index + m[0].length; continue }
      closes++
      if (depth > 0 && --depth === 0) blocks.push(text.slice(start, m.index).replace(/<[^>]*>|\[[^\]]*\]|\{[^}]*\}/g, ' '))
    }
  }
  return { blocks, opens, closes }
}

function scanText(text, forbidden) {
  const toks = tokens(text), hits = []
  for (let i = 0; i + K <= toks.length; i++) {
    if (!forbidden.has(toks.slice(i, i + K).map(t => t[0]).join(' '))) continue
    hits.push(text.slice(0, toks[i][1]).split('\n').length)
    i += K - 1
  }
  return hits
}

const violations = []
for (const file of files) {
  if (FORBIDDEN_DIR.test(file)) violations.push({ file, rule: 'forbidden-path' })
  if (FORBIDDEN_EXT.test(file)) violations.push({ file, rule: 'forbidden-extension' })
  const path = join(root, file)
  // Staged content is what a commit would record; the worktree is what the next add would stage. Check both.
  if (!SIZE_EXEMPT.has(file) && tracked.has(file)) {
    const s = stagedSize(file)
    if (s !== null && s > MAX_BYTES) violations.push({ file, rule: 'oversized-staged' })
  }
  if (existsSync(path) && !SIZE_EXEMPT.has(file) && statSync(path).size > MAX_BYTES) {
    violations.push({ file, rule: tracked.has(file) ? 'oversized-worktree' : 'oversized' })
  }
}

const story = loadStoryText()
let fingerprint = { available: false, blocks: 0, shingles: 0, selfTest: 'skipped', filesScanned: 0 }
if (story) {
  const { blocks } = story
  const forbidden = new Set(blocks.flatMap(b => shingles(tokens(b))))
  // Known-true case first: a planted fixture must be caught, and plain prose must not be.
  const planted = [...forbidden].find(s => s.split(' ').every(w => /^[a-z]+$/.test(w)))
  const caught = planted && scanText(`header\n\n${planted}\n`, forbidden).length === 1
  const clean = scanText('the port keeps the original scripts and assets and never rewrites them for any reason at all', forbidden).length === 0
  // Coverage: every <PRE> open must pair with a close, or blocks were silently truncated.
  const covered = story.opens === story.closes && blocks.length > 0
  fingerprint = { available: true, blocks: blocks.length, preTags: { opens: story.opens, closes: story.closes }, shingles: forbidden.size,
    selfTest: caught && clean && covered ? 'pass' : 'fail', filesScanned: 0,
    blindTo: 'choice, menu and other strings outside <PRE> story blocks' }
  if (fingerprint.selfTest === 'pass') for (const file of files) {
    if (FORBIDDEN_EXT.test(file)) continue // game types are refused by the extension rule, never text-scanned
    const path = join(root, file)
    // Prefer the staged blob for tracked files: it is exactly what a commit would record.
    const buf = tracked.has(file) ? stagedBytes(file) : (existsSync(path) ? readFileSync(path) : null)
    if (!buf || buf.length > MAX_BYTES * 4) continue
    if (buf.includes(0)) continue // binary; covered by the extension and size rules
    fingerprint.filesScanned++
    const lines = scanText(buf.toString('utf8'), forbidden)
    if (lines.length) violations.push({ file, rule: 'story-text', lines: lines.slice(0, 20), count: lines.length })
  }
}

const textFiles = files.filter(f => existsSync(join(root, f)) && !FORBIDDEN_EXT.test(f)).length
const ok = violations.length === 0 && fingerprint.selfTest !== 'fail'
const proof = { createdAt: new Date().toISOString(), ok, filesChecked: files.length, fingerprint, violations }
await writeProof('re/verification/firewall.json', proof)
for (const v of violations) console.log(`  ${v.rule}: ${v.file}${v.lines ? ` lines ${v.lines.join(',')}${v.count > 20 ? ' …' : ''}` : ''}`)
const textNote = !fingerprint.available ? 'story-text check UNAVAILABLE (no game-data/nss*)'
  : fingerprint.selfTest === 'fail' ? 'story-text self-test FAILED, check not trusted'
  : `story text ${fingerprint.filesScanned}/${textFiles} non-binary files vs ${fingerprint.shingles} shingles from ${fingerprint.blocks} blocks (blind to ${fingerprint.blindTo})`
console.log(`Firewall ${ok ? 'PASS' : 'FAIL'} | ${files.length} files | ${violations.length} violations | ${textNote} | proof re/verification/firewall.json`)
process.exit(ok ? 0 : 1)
