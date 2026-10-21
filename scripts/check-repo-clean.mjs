#!/usr/bin/env node
// Proves this repo holds no game content: fails on game file types, game-data folders,
// oversized blobs, story-like text (long Japanese runs / long quoted passages), and
// personal leftovers (domains, home paths, LAN addresses, push topics).
// Run: npm run check-clean. Wire it into CI so a leak fails the build.
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FORBIDDEN_DIR = /^(game-data|re|ref|private|public\/game|dist|engine|media|reader)\//i
const FORBIDDEN_EXT = /\.(exe|dll|ogg|wav|mp3|m4a|aac|opus|jpg|jpeg|png|bmp|webp|avif|gif|tlg|mpg|mpeg|avi|wmv|mp4|webm|ttf|otf|pfs|arc|xp3|npa|dat|pak|nss|asb|iet|pyc)$/i
const MAX_BYTES = 2 * 1024 * 1024
const TEXT_ALLOW_EXT = new Set(['.md', '.mjs', '.mts', '.ts', '.js', '.json', '.ps1', '.py', '.sh', '.txt', '.html'])
const STORY_PATTERNS = [/[぀-ヿ㐀-鿿！-～]{12,}/, /[「『“”][^」』“”]{40,}[」』“”]/]
const SECRET_PATTERNS = [/nevichan/i, /C:\\Users\\nevi/i, /C:\/Users\/nevi/i, /192\.168\.\d+\.\d+/, /nevi-desk-[a-z0-9]+/i, /The Song of Saya\/The Song of Saya/]

const rawGit = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const gitBytes = args => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'buffer', maxBuffer: 64 << 20 }) } catch { return null }
}
// First bytes of common game binaries: catches an exe/audio/image committed as .txt or with no extension.
// Formats without a magic number are covered only by the path/extension/size rules below - this check is a
// heuristic layer, not a proof that copyrighted content is absent (see docs/RELIABILITY-AUDIT.md).
const sniffMagic = buf => {
  if (!buf || buf.length < 3) return null
  const b = buf
  if (b[0] === 0x4D && b[1] === 0x5A) return 'windows-binary'
  if (b.length >= 4 && b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'ogg-audio'
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png-image'
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg-image'
  if (b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif-image'
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp-image'
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'mp4-video'
  return null
}
let list
try {
  list = [...new Set([...rawGit(['ls-files', '-z', '--cached']).split('\0'), ...rawGit(['ls-files', '-z', '--others', '--exclude-standard']).split('\0')].filter(Boolean))]
} catch {
  if (existsSync(join(root, '.git'))) {
    // A git checkout whose index cannot be read: staged content cannot be inspected, so fail closed.
    console.error('clean: FAIL - git cannot read this checkout, so staged content cannot be inspected (fail closed)')
    process.exit(1)
  }
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
const tracked = new Set()
try {
  for (const f of execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: root, encoding: 'utf8' }).split('\0')) if (f) tracked.add(f)
} catch {}
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
  // Staged content is what a commit would record: check the staged blob size too, so shrinking the
  // worktree after staging a blob cannot hide it.
  if (tracked.has(file) && file !== 'package-lock.json') {
    const sizeOut = (gitBytes(['cat-file', '-s', ':0:' + file]) ?? Buffer.alloc(0)).toString('utf8').trim()
    if (/^\d+$/.test(sizeOut) && Number(sizeOut) > MAX_BYTES) violations.push(`${file}: oversized staged blob (>2 MiB)`)
  }
  // Renamed binaries: staged bytes for tracked files, first worktree bytes for untracked ones.
  if (!/public\/icons\//.test(file)) {
    const staged = tracked.has(file) ? gitBytes(['cat-file', 'blob', ':0:' + file]) : null
    let head = staged ? staged.slice(0, 12) : null
    if (!head) {
      try {
        const fd = openSync(p, 'r')
        try { const buf = Buffer.alloc(12); head = buf.slice(0, readSync(fd, buf, 0, 12, 0)) } finally { closeSync(fd) }
      } catch { head = null }
    }
    const kind = sniffMagic(head)
    if (kind) violations.push(`${file}: renamed game binary (${kind} magic under an innocent name)`)
  }
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
