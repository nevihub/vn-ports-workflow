// Shared cross-port knowledge (VN-Ports\knowledge). `npm run issue -- learn` appends to LESSONS.md's lesson log;
// the board lists recent entries; `npm run kb` searches an explicit allowlist of agent docs (never game data).
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const findVnRoot = () => {
  let dir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  for (;;) {
    if (existsSync(join(dir, 'AGENTS.md')) && existsSync(join(dir, 'knowledge', 'DEFAULTS.md'))) return dir
    const paired = join(dir, 'root')
    if (existsSync(join(paired, 'AGENTS.md')) && existsSync(join(paired, 'knowledge', 'DEFAULTS.md'))) return paired
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

export const VN_ROOT = findVnRoot()
export const KNOWLEDGE = join(VN_ROOT, 'knowledge')
export const LESSONS = join(KNOWLEDGE, 'LESSONS.md')
const LOG_HEADING = '## Lesson log'

// Story text must never land in shared docs. Lessons are about engineering, so anything that reads like quoted
// dialogue or a run of Japanese prose is refused (names like 立ち絵 or a short kana term are fine).
export function storyLike (text) {
  const t = String(text ?? '')
  if (/[぀-ヿ㐀-鿿！-～]{12,}/.test(t)) return 'a long run of Japanese text'
  if (/[「『“"][^」』”"]{40,}[」』”"]/.test(t)) return 'a long quoted passage'
  return null
}

// `- 2026-10-18 [sakura] (engine, wasm) text - by claude`
export function formatLesson ({ date, project, tags = [], text, by }) {
  const tagPart = tags.length ? ` (${tags.join(', ')})` : ''
  return `- ${date} [${project}]${tagPart} ${text.trim().replace(/\s+/g, ' ')}${by ? ` - by ${by}` : ''}`
}

export function appendLesson (entry, file = LESSONS) {
  const why = storyLike(entry.text)
  if (why) throw new Error(`refused: the lesson contains ${why}. Describe the engineering point, never story text.`)
  if (!existsSync(file)) throw new Error(`no ${file} - the shared knowledge folder is missing`)
  let md = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n')
  if (!md.includes(LOG_HEADING)) md = `${md.trimEnd()}\n\n${LOG_HEADING}\nNewest last. Added with \`npm run issue -- learn "<lesson>" --tags a,b\` from any game.\n`
  const line = formatLesson(entry)
  writeFileSync(file, `${md.trimEnd()}\n${line}\n`)
  return line
}

export function recentLessons (limit = 30, file = LESSONS) {
  let md
  try { md = readFileSync(file, 'utf8').replace(/\r\n?/g, '\n') } catch { return [] }
  const i = md.indexOf(LOG_HEADING)
  if (i < 0) return []
  const out = []
  for (const line of md.slice(i).split('\n')) {
    const m = line.match(/^- (\d{4}-\d{2}-\d{2}) \[([^\]]+)\](?: \(([^)]*)\))? (.*?)(?: - by (.+))?$/)
    if (m) out.push({ date: m[1], project: m[2], tags: m[3] ? m[3].split(/,\s*/) : [], text: m[4], by: m[5] ?? null })
  }
  return out.reverse().slice(0, limit)
}

// The only files `npm run kb` reads. Game folders are walked by name, never recursively, so game-data/, re/, ref/,
// private/, media/ and engine/ can never be searched or printed.
export function kbFiles (projects) {
  const files = []
  const add = (label, path) => { if (existsSync(path)) files.push({ label, path }) }
  try { for (const f of readdirSync(KNOWLEDGE).filter(f => /\.md$/i.test(f)).sort((a, b) => a.localeCompare(b))) add('knowledge', join(KNOWLEDGE, f)) } catch {}
  add('vn-ports', join(VN_ROOT, 'AGENTS.md'))
  for (const p of projects) {
    if (!p.root) continue
    for (const f of ['AGENTS.md', 'CLAUDE.md', 'HANDOFF.md', 'STATUS.md', 'README.md']) add(p.id, join(p.root, f))
    const docs = join(p.root, 'docs')
    let names = []
    try { names = readdirSync(docs).sort((a, b) => a.localeCompare(b)) } catch {}
    for (const f of names) {
      if (/^(DECISIONS|BACKLOG|HISTORY|LESSONS|WORKFLOW|MOBILE.*|.*SPEC.*|COMMANDS)\.md$/i.test(f)) add(p.id, join(docs, f))
    }
  }
  return rankKbFiles(files)
}

const kbRank = file => {
  const name = file.path.split(/[\\/]/).at(-1).toUpperCase()
  if (name === 'LESSONS.MD' || name === 'DECISIONS.MD') return 0
  if (file.label === 'vn-ports' || ['AGENTS.MD', 'CLAUDE.MD', 'HANDOFF.MD', 'STATUS.MD', 'README.MD'].includes(name)) return 1
  if (name === 'BACKLOG.MD' || name === 'HISTORY.MD') return 4
  if (file.label === 'knowledge') return 2
  return 3
}

// Keep the original corpus and matching behavior, but search high-value current
// context first and leave large ticket/history ledgers until the end.
export function rankKbFiles (files) {
  return files.map((file, index) => ({ file, index, rank: kbRank(file) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(entry => entry.file)
}

// Every query word must appear on the line (case-insensitive). Returns [{ label, path, line, text }].
export function kbSearch (query, files, { limit = 60 } = {}) {
  const words = String(query).toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const hits = []
  for (const f of files) {
    let lines
    try { lines = readFileSync(f.path, 'utf8').split(/\r?\n/) } catch { continue }
    lines.forEach((text, i) => {
      const low = text.toLowerCase()
      if (words.every(w => low.includes(w))) hits.push({ label: f.label, path: f.path, line: i + 1, text: text.trim() })
    })
  }
  return hits.slice(0, limit)
}
