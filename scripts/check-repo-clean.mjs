#!/usr/bin/env node
// Proves this repo holds no game content: fails on game file types, game-data folders,
// oversized blobs, story-like text (long Japanese runs / long quoted passages), and
// personal leftovers (domains, home paths, LAN addresses, push topics).
// Run: npm run check-clean. Wire it into CI so a leak fails the build.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FORBIDDEN_DIR = /^(game-data|re|ref|private|public\/game|dist|engine|media|reader)\//i
const FORBIDDEN_EXT = /\.(exe|dll|ogg|wav|mp3|m4a|aac|opus|jpg|jpeg|png|bmp|webp|avif|gif|tlg|mpg|mpeg|avi|wmv|mp4|webm|ttf|otf|pfs|arc|xp3|npa|dat|pak|nss|asb|iet|pyc)$/i
const MAX_BYTES = 2 * 1024 * 1024
const TEXT_ALLOW_EXT = new Set(['.md', '.mjs', '.mts', '.ts', '.js', '.json', '.ps1', '.py', '.sh', '.txt', '.html'])
const STORY_PATTERNS = [/[぀-ヿ㐀-鿿！-～]{12,}/, /[「『“”][^」』“”]{40,}[」』“”]/]
const SECRET_PATTERNS = [/nevichan/i, /C:\\Users\\nevi/i, /C:\/Users\/nevi/i, /192\.168\.\d+\.\d+/, /nevi-desk-[a-z0-9]+/i, /The Song of Saya\/The Song of Saya/]

const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
let list
try {
  list = [...new Set([...git(['ls-files', '-z', '--cached']).split('\0'), ...git(['ls-files', '-z', '--others', '--exclude-standard']).split('\0')].filter(Boolean))]
} catch {
  // Not a git checkout (or git missing): walk the tree instead, minus node_modules/.git.
  const { readdirSync } = await import('node:fs')
  list = []
  const walk = d => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      const rel = join(d, e.name).replace(/\\/g, '/')
      if (e.isDirectory()) walk(join(root, rel))
      else list.push(rel.replace(/^\.\//, ''))
    }
  }
  walk('.')
  list = list.map(f => f.replace(/^\.\//, ''))
}

const violations = []
for (const file of list) {
  if (FORBIDDEN_DIR.test(file)) violations.push(`${file}: forbidden game-data folder`)
  if (FORBIDDEN_EXT.test(file) && !/public\/icons\//.test(file)) {
    violations.push(`${file}: forbidden game file type (contents never printed)`)
  }
  const p = join(root, file)
  try {
    if (existsSync(p) && statSync(p).isFile() && statSync(p).size > MAX_BYTES && file !== 'package-lock.json') {
      violations.push(`${file}: oversized blob (>2 MiB)`)
    }
  } catch {}
  const ext = '.' + (file.split('.').pop() ?? '').toLowerCase()
  if (TEXT_ALLOW_EXT.has(ext)) {
    let text
    try { text = readFileSync(p, 'utf8') } catch { continue }
    // Carve-out: lines that call storyLike( are the detector's own unit tests (planted
    // fixtures proving it refuses story text), not leaked content.
    // This checker file itself is also skipped: it names the patterns it guards by design.
    if (file === 'scripts/check-repo-clean.mjs') continue
    for (const line of text.split('\n')) {
      if (/storyLike\s*\(/.test(line)) continue
      for (const pat of STORY_PATTERNS) {
        if (pat.test(line)) { violations.push(`${file}: story-like text (${pat})`); break }
      }
      if (violations.length && violations[violations.length - 1].startsWith(file + ':')) break
      for (const pat of SECRET_PATTERNS) {
        if (pat.test(line)) { violations.push(`${file}: personal leftover (${pat})`); break }
      }
      if (violations.length && violations[violations.length - 1].startsWith(file + ':')) break
    }
  }
}

if (violations.length) {
  for (const v of violations) console.error(`clean: FAIL - ${v}`)
  console.error(`clean: FAIL - ${violations.length} problem(s) in ${list.length} files (contents never printed)`)
  process.exit(1)
}
console.log(`clean: PASS - ${list.length} files checked (no game content, no story text, no personal leftovers)`)
