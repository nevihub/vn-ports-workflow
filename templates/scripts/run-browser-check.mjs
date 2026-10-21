// Run an authored Playwright harness in its own temporary browser profile.
// Reuses a cached Playwright package; this runner never installs tools.
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Script } from 'node:vm'
import { checkpoint, findCachedPackage, writeProof } from './lib/automation.mjs'

const usage = `Usage: node scripts/run-browser-check.mjs <harness.js> <proof.json> [--origin URL]

The proof path must be under the ignored re/ directory. GAME_TEST_ORIGIN remains
supported; --origin takes precedence. Playwright is resolved from an existing
local or npm cache. On Windows, installed Chrome is used by default.`

let harness = null, output = null, phase = 'arguments', startedAt = Date.now()
function safeFailure(error) {
  const name = /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(error?.name ?? '') ? error.name : 'Error'
  const code = /^[A-Z0-9_]{1,60}$/.test(error?.code ?? '') ? error.code : null
  return { name, ...(code ? { code } : {}) }
}

function parseArgs(args) {
  if (args[0] === '--help' || args[0] === '-h') return { help: true }
  const [script, proof, ...rest] = args
  if (!script || !proof) throw Object.assign(new Error(), { code: 'USAGE' })
  let origin = null
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] !== '--origin' || !rest[i + 1] || rest[i + 1].startsWith('--')) throw Object.assign(new Error(), { code: 'USAGE' })
    origin = rest[++i]
  }
  return { script, proof, origin }
}

async function main() {
  const argv = process.argv.slice(2)
  if (!['--help', '-h'].includes(argv[0])) { harness = argv[0] ?? null; output = argv[1] ?? null }
  const args = parseArgs(argv)
  if (args.help) { console.log(usage); return }
  harness = args.script
  output = args.proof
  const timeoutMs = Number(process.env.GAME_CHECK_TIMEOUT_MS || 300000)
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw Object.assign(new Error(), { code: 'INVALID_TIMEOUT' })
  const extraOptions = JSON.parse(process.env.GAME_CHECK_OPTIONS || '{}')
  if (!extraOptions || Array.isArray(extraOptions) || typeof extraOptions !== 'object') throw Object.assign(new Error(), { code: 'INVALID_OPTIONS' })
  const originValue = args.origin ?? process.env.GAME_TEST_ORIGIN ?? null
  const origin = originValue ? new URL(originValue) : null
  if (origin && (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password)) throw Object.assign(new Error(), { code: 'INVALID_ORIGIN' })
  const sourceCheckpoint = checkpoint()
  const checkpointLabel = process.env.GAME_ENGINE_CHECKPOINT || `${sourceCheckpoint.head}${sourceCheckpoint.dirty ? '-dirty' : ''}`
  const playwrightModule = process.env.GAME_PLAYWRIGHT_MODULE || findCachedPackage('playwright')
  const { chromium } = createRequire(import.meta.url)(playwrightModule)
  const channel = process.env.GAME_BROWSER_CHANNEL || (process.platform === 'win32' ? 'chrome' : undefined)
  let browser, deadline
  try {
    phase = 'launch'
    browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) })
    phase = 'harness'
    const page = await browser.newPage()
    let source = await readFile(resolve(harness), 'utf8')
    if (origin) source = source.replaceAll('http://127.0.0.1:5317', origin.origin)
    const run = new Script(source, { filename: harness }).runInThisContext()
    if (typeof run !== 'function') throw Object.assign(new Error(), { code: 'INVALID_HARNESS' })
    const options = { ...extraOptions, commit: checkpointLabel, route: JSON.parse(process.env.GAME_ROUTE || '[]'),
      ...(origin ? { origin: origin.href } : {}),
      progress: async metadata => { await writeProof(`${output}.progress.json`, metadata) } }
    const proof = await Promise.race([
      run(page, options),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(Object.assign(new Error(), { name: 'TimeoutError', code: 'CHECK_TIMEOUT' })), timeoutMs) }),
    ])
    clearTimeout(deadline)
    phase = 'write-proof'
    // Stamp the source state so scripts/check-proofs.mjs can tell when this proof goes stale.
    const proofPath = await writeProof(output, proof && typeof proof === 'object' && !proof.source ? { ...proof, source: sourceCheckpoint } : proof)
    console.log(JSON.stringify({ harness, proof: proofPath, ok: proof?.ok === true }))
    process.exitCode = proof?.ok === true ? 0 : 1
  } finally {
    clearTimeout(deadline)
    await browser?.close().catch(() => {})
  }
}

try {
  await main()
} catch (error) {
  const proof = { ok: false, harness: harness ?? null, source: checkpoint(), phase,
    failure: safeFailure(error), durationMs: Date.now() - startedAt }
  let proofPath = null
  if (output) proofPath = await writeProof(output, proof).catch(() => null)
  console.log(JSON.stringify({ ok: false, harness: harness ?? null, phase, failure: proof.failure, proof: proofPath }))
  process.exitCode = 1
}
