// Cache parsed ledgers by canonical path and filesystem identity. Findings and
// time-dependent state are deliberately computed by callers on every request.
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from './ledger.mjs'

const cache = new Map()
const canonical = path => {
  try { return realpathSync.native(path) } catch { return resolve(path) }
}
const identity = st => `${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`

export function parsedLedger (path) {
  const key = canonical(path)
  let before
  try { before = statSync(key, { bigint: true }) } catch { cache.delete(key); return { path: key, md: null, items: null, identity: null } }
  const id = identity(before)
  const hit = cache.get(key)
  if (hit?.identity === id) return hit
  // Read and stat again so a concurrent ledger write cannot poison the cache
  // with text that does not match the metadata used as its cache key.
  let md
  try { md = readFileSync(key, 'utf8') } catch { cache.delete(key); return { path: key, md: null, items: null, identity: null } }
  let after
  try { after = statSync(key, { bigint: true }) } catch { cache.delete(key); return { path: key, md, items: parse(md), identity: null } }
  const next = { path: key, md, items: parse(md), identity: identity(after) }
  if (id === next.identity) cache.set(key, next)
  else cache.delete(key)
  return next
}

export function evictParsedLedger (path) {
  cache.delete(canonical(path))
}

export function evictParsedLedgersExcept (paths) {
  const keep = new Set([...paths].map(canonical))
  for (const path of cache.keys()) if (!keep.has(path)) cache.delete(path)
}

export function parsedLedgerCacheSize () { return cache.size }
