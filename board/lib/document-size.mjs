import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export const CURRENT_STATE_LIMITS = Object.freeze({ lines: 60, bytes: 4500 })

export function measureDocument (text) {
  const normalized = String(text).replace(/\r\n?/g, '\n').replace(/\n$/, '')
  return { lines: normalized ? normalized.split('\n').length : 0, bytes: Buffer.byteLength(normalized, 'utf8') }
}

export function documentSizeFinding (label, text, { lines = CURRENT_STATE_LIMITS.lines, bytes = CURRENT_STATE_LIMITS.bytes } = {}) {
  const measured = measureDocument(text)
  if (measured.lines <= lines && measured.bytes <= bytes) return null
  return { level: 'check', code: 'document-size', id: null,
    text: `current-state document ${label} is ${measured.lines} lines and ${measured.bytes} UTF-8 bytes (limits ${lines} lines and ${bytes} bytes)`,
    suggest: 'Move historical completion details to the game history file and keep the current state here.' }
}

export function currentStateFiles (project, { root = project?.root } = {}) {
  const files = []
  const add = (path, label) => { if (path && existsSync(path)) files.push({ path, label }) }
  if (root) {
    add(join(root, 'HANDOFF.md'), `${project?.id ?? 'game'}/HANDOFF.md`)
    add(join(root, 'STATUS.md'), `${project?.id ?? 'game'}/STATUS.md`)
  }
  return files
}

export function currentStateFindings (project, options = {}) {
  return currentStateFiles(project, options).flatMap(({ path, label }) => {
    let text
    try { text = readFileSync(path, 'utf8') } catch { return [] }
    const finding = documentSizeFinding(label, text)
    return finding ? [finding] : []
  })
}

export const currentStateLabel = path => basename(path)
