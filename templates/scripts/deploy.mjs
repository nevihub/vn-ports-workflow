import { readdir, readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { cachedCli, checkpoint, root, runLogged, writeProof } from './lib/automation.mjs'

const usage = `Usage: node scripts/deploy.mjs [--original|--compressed|--prepared] [--dry-run] [--help]

Prepares a build or uses the existing split dist/, then deploys only to the
existing Cloudflare Pages project saya on branch main.`

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) { console.log(usage); process.exit(0) }
const modes = argv.filter(arg => ['--original', '--compressed', '--prepared'].includes(arg))
const allowed = new Set([...modes, '--dry-run'])
for (const arg of new Set(argv)) if (!allowed.has(arg)) { console.error(`Unknown option: ${arg}\n\n${usage}`); process.exit(2) }
if (modes.length > 1) { console.error('Choose only one deploy mode.'); process.exit(2) }
const mode = modes[0]?.slice(2) ?? 'compressed'
async function validatePreparedDist() {
  const gameDir = resolve(root, 'dist/game')
  const manifest = JSON.parse(await readFile(resolve(gameDir, 'parts.json'), 'utf8'))
  const expected = ['cg', 'sound', 'voice', 'nss', 'system']
  if (manifest.partSize !== 1024 * 1024 || !/^[a-f0-9]{12}$/i.test(manifest.version) || !manifest.sizes || typeof manifest.sizes !== 'object' ||
      Array.isArray(manifest.sizes) || expected.some(name => !Number.isInteger(manifest.sizes[name]) || manifest.sizes[name] < 1) || Object.keys(manifest.sizes).length !== expected.length) throw new Error('INVALID_SPLIT_MANIFEST')
  const files = await readdir(gameDir)
  if (files.some(name => name.endsWith('.npa'))) throw new Error('UNSPLIT_ARCHIVE_PRESENT')
  const sizes = {}, blocks = {}
  for (const name of expected) {
    const bytes = manifest.sizes[name], count = Math.ceil(bytes / manifest.partSize)
    let total = 0
    for (let index = 0; index < count; index++) {
      const blockName = `${name}.npa.${index}`
      if (!files.includes(blockName)) throw new Error('MISSING_ARCHIVE_BLOCK')
      const blockSize = (await stat(resolve(gameDir, blockName))).size
      const wanted = Math.min(manifest.partSize, bytes - index * manifest.partSize)
      if (blockSize !== wanted) throw new Error('INVALID_ARCHIVE_BLOCK_SIZE')
      total += blockSize
    }
    if (total !== bytes) throw new Error('ARCHIVE_SIZE_MISMATCH')
    sizes[`${name}.npa`] = bytes
    blocks[`${name}.npa`] = count
  }
  const expectedBlocks = new Set(expected.flatMap(name => Array.from({ length: blocks[`${name}.npa`] }, (_, index) => `${name}.npa.${index}`)))
  if (files.some(name => /\.npa\.\d+$/.test(name) && !expectedBlocks.has(name))) throw new Error('UNEXPECTED_ARCHIVE_BLOCK')
  return { partSize: manifest.partSize, version: manifest.version, archiveSizes: sizes, blocks }
}

if (argv.includes('--dry-run')) {
  if (mode === 'prepared') {
    try {
      const archives = await validatePreparedDist()
      cachedCli('wrangler')
      const total = Object.values(archives.archiveSizes).reduce((sum, size) => sum + size, 0)
      console.log(`Deploy preflight PASS | prepared dist/ valid | archives ${total} bytes | version ${archives.version} | Wrangler available | project saya, branch main | no writes, build, or Cloudflare requests made`)
      process.exit(0)
    } catch (error) {
      const reason = /^(INVALID_|UNSPLIT_|MISSING_|ARCHIVE_|UNEXPECTED_)/.test(error?.message ?? '') ? error.message : 'PREPARED_DIST_OR_WRANGLER_UNAVAILABLE'
      console.error(`Deploy preflight FAIL | ${reason} | no writes, build, or Cloudflare requests made`)
      process.exit(1)
    }
  }
  console.log(`Deploy plan: ${mode === 'prepared' ? 'validate existing split dist/' : `prepare ${mode} archives in dist/`} -> Cloudflare Pages project saya, branch main | no build, filesystem changes, or Cloudflare requests made`)
  process.exit(0)
}

const steps = []
const proofFile = 're/verification/deploy.json'
let failure = null, deploymentUrl = null, archiveData = null
const run = async (id, command, args) => {
  const result = await runLogged(id, command, args, { log: `re/verification/${id}.log` })
  steps.push(result)
  if (!result.ok) throw new Error(`${id} failed`)
  return result
}
try {
  if (mode !== 'prepared') await run('deploy-prepare', process.execPath, ['scripts/prepare-build.mjs', `--${mode}`])
  archiveData = await validatePreparedDist()
  await run('deploy-wrangler', process.execPath, [cachedCli('wrangler'), 'pages', 'deploy', 'dist', '--project-name', 'saya', '--branch', 'main', '--commit-dirty=true'])
  const deployStep = steps.find(step => step.id === 'deploy-wrangler')
  const { readFile: readLog } = await import('node:fs/promises')
  const log = await readLog(resolve(root, deployStep.log), 'utf8')
  deploymentUrl = log.match(/https:\/\/[a-f0-9]{8,}\.[a-z0-9-]+\.pages\.dev\b/i)?.[0] ?? null
  if (!deploymentUrl) failure = 'DEPLOY_URL_NOT_FOUND_IN_WRANGLER_OUTPUT'
} catch (error) {
  failure = error?.message?.startsWith('deploy-') ? error.message : /^(INVALID_|UNSPLIT_|MISSING_|ARCHIVE_|UNEXPECTED_)/.test(error?.message ?? '') ? error.message : 'DEPLOY_PREPARATION_FAILED'
}

const ok = !failure && steps.some(step => step.id === 'deploy-wrangler' && step.ok) && !!deploymentUrl
const proof = { createdAt: new Date().toISOString(), checkpoint: checkpoint(), mode, project: 'saya', branch: 'main', dist: 'dist',
  ...archiveData, deploymentUrl, failure, steps: steps.map(({ id, ok, exitCode, error, durationMs, log }) => ({ id, ok, exitCode, error, durationMs, log })), ok }
try { await writeProof(proofFile, proof) } catch { console.error('Could not write deployment proof under re/.'); process.exit(1) }
console.log(`Deploy ${ok ? 'SUCCESS' : 'FAILED'} | mode ${mode} | ${steps.map(step => `${step.id} ${step.ok ? 'ok' : 'failed'} ${step.durationMs}ms`).join(' | ') || 'no steps completed'}${deploymentUrl ? ` | ${deploymentUrl}` : ''}${failure ? ` | ${failure}` : ''} | proof ${proofFile}`)
if (!ok) process.exit(1)
