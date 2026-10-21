// Verify that a deployed shell references and serves the exact prepared engine assets.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { checkpoint, root, writeProof } from './lib/automation.mjs'
import { derived, requireGameConfig } from './lib/game-config.mjs'

// The checked site defaults to the configured production domain (ticket U1); a placeholder refuses
// with a pointer instead of probing someone else's example URL. Archive names are not needed here,
// so this stays a dev-loop check: only a missing/unparsable config or placeholder domain refuses.
const { domain } = derived(requireGameConfig(root))
if (!domain) throw new Error('GAME_NOT_CONFIGURED: game.config.json deploy.domain is a placeholder (ticket U1 sets the production domain)')

const usage = 'Usage: npm run check:shell -- [--origin URL] [--dist dist] [--proof re/verification/shell-assets.json]'
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) { console.log(usage); process.exit(0) }
const options = { origin: domain, dist: 'dist', proof: 're/verification/shell-assets.json' }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
let proof
try {
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2)
    if (!args[i].startsWith('--') || !Object.hasOwn(options, key) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw Object.assign(new Error(), { code: 'USAGE' })
    options[key] = args[i + 1]
  }
  const origin = new URL(options.origin), dist = resolve(root, options.dist)
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) throw Object.assign(new Error(), { code: 'INVALID_ORIGIN' })
  const localHtml = await readFile(resolve(dist, 'index.html'), 'utf8')
  const paths = [...new Set([...localHtml.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(m => m[1]))]
  if (!paths.some(path => path.endsWith('.js'))) throw Object.assign(new Error(), { code: 'MISSING_ENGINE_ASSET' })
  const fetchFresh = path => fetch(new URL(path, origin), { cache: 'no-store', signal: AbortSignal.timeout(30000) })
  const response = await fetchFresh('/')
  const liveHtml = await response.text()
  const assets = []
  for (const path of [...paths, '/sw.js']) {
    const localPath = resolve(dist, path.slice(1))
    if (!localPath.startsWith(dist + sep)) throw Object.assign(new Error(), { code: 'INVALID_ASSET_PATH' })
    const local = await readFile(localPath), remote = await fetchFresh(path)
    const bytes = Buffer.from(await remote.arrayBuffer())
    assets.push({ path, referenced: path === '/sw.js' || liveHtml.includes(path), status: remote.status,
      localBytes: local.length, liveBytes: bytes.length, localSha256: sha(local), liveSha256: sha(bytes),
      matches: remote.status === 200 && sha(local) === sha(bytes) })
  }
  proof = { origin: origin.href, createdAt: new Date().toISOString(), checkpoint: checkpoint(),
    htmlStatus: response.status, assets, ok: response.status === 200 && assets.every(asset => asset.referenced && asset.matches) }
} catch (error) {
  proof = { ok: false, createdAt: new Date().toISOString(), checkpoint: checkpoint(),
    failure: { name: error?.name === 'TimeoutError' ? 'TimeoutError' : 'Error',
      code: /^[A-Z0-9_]{1,50}$/.test(error?.code ?? '') ? error.code : 'SHELL_CHECK_FAILED' } }
}
await writeProof(options.proof, proof)
console.log(JSON.stringify({ ok: proof.ok, assets: proof.assets?.map(({ path, matches, referenced }) => ({ path, matches, referenced })),
  ...(proof.failure ? { failure: proof.failure } : {}), proof: options.proof }))
if (!proof.ok) process.exitCode = 1
