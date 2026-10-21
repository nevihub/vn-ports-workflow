import { readFileSync, statSync } from 'node:fs'

const cache = new Map()
const identity = st => `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`
const fnv = text => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16)
}

export function cachedPage (path) {
  const key = path
  const st = statSync(path, { bigint: true })
  const id = identity(st)
  const hit = cache.get(key)
  if (hit?.identity === id) return hit
  const shell = readFileSync(path, 'utf8')
  let after
  try { after = statSync(path, { bigint: true }) } catch { cache.delete(key); return { shell, version: fnv(shell), identity: null } }
  const entry = { shell, version: fnv(shell), identity: identity(after) }
  if (id === entry.identity) cache.set(key, entry)
  else cache.delete(key)
  return entry
}

export function pageCacheSize () { return cache.size }
