import { existsSync } from 'node:fs'
import { rm, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { checkpoint, localCli, root, runLogged, writeProof } from './lib/automation.mjs'

const usage = `Usage: node scripts/verify.mjs [--build] [--help]

Runs the content firewall, local Vitest, the all-script parser check, and TypeScript. --build replaces
the standalone TypeScript check with TypeScript plus a Vite production build.`

const args = new Set(process.argv.slice(2))
if (args.has('--help') || args.has('-h')) { console.log(usage); process.exit(0) }
for (const arg of args) if (arg !== '--build') { console.error(`Unknown option: ${arg}\n\n${usage}`); process.exit(2) }

const proofFile = 're/verification/verify.json'
const hasScriptData = existsSync(resolve(root, 'game-data/nss'))
const steps = []
const testReport = resolve(root, 're/verification/vitest.json')
let testReportCleared = false
const record = async (id, command, commandArgs, options) => {
  const result = await runLogged(id, command, commandArgs, options)
  steps.push(result)
  return result
}

let setupError = null
try {
  await rm(testReport, { force: true })
  testReportCleared = true
  const vitest = localCli('vitest')
  const viteNode = localCli('vite-node')
  const tsc = localCli('typescript')
  const vite = localCli('vite')
  const node = process.execPath
  await record('verify-firewall', node, ['scripts/check-firewall.mjs'], { log: 're/verification/verify-firewall.log' })
  await record('verify-vitest', node, [vitest, 'run', '--reporter=json', '--outputFile=re/verification/vitest.json'], { log: 're/verification/verify-vitest.log' })
  if (hasScriptData) {
    const check = await record('verify-scripts', node, [viteNode, 'scripts/check-scripts.ts'], { log: 're/verification/verify-scripts.log' })
    const logPath = resolve(root, check.log)
    const output = await readFile(logPath, 'utf8')
    const match = output.match(/(?:^|\n)(\d+) parsed\s*$/)
    check.parsed = match ? Number(match[1]) : null
    check.ok = check.ok && check.parsed === 82
    if (!check.ok && check.exitCode === 0 && check.parsed !== 82) check.error = 'SCRIPT_COUNT_MISMATCH'
  } else {
    steps.push({ id: 'verify-scripts', exitCode: null, error: 'MISSING_GAME_SCRIPT_DATA', durationMs: 0, log: null, ok: false, parsed: null })
  }
  if (args.has('--build')) {
    await record('verify-build-tsc', node, [tsc, '--noEmit'], { log: 're/verification/verify-build-tsc.log' })
    await record('verify-build-vite', node, [vite, 'build'], { log: 're/verification/verify-build-vite.log' })
  } else {
    await record('verify-tsc', node, [tsc, '--noEmit'], { log: 're/verification/verify-tsc.log' })
  }
} catch (error) {
  setupError = error?.message === 'Installed CLI unavailable: vitest' ? 'VITEST_NOT_INSTALLED' : 'LOCAL_TOOL_UNAVAILABLE'
}

let testCounts = null
let testReportError = 'TEST_REPORT_MISSING_OR_INVALID'
const executedTestStep = steps.find(step => step.id === 'verify-vitest')
try { if (testReportCleared && executedTestStep) {
  const report = JSON.parse(await readFile(resolve(root, 're/verification/vitest.json'), 'utf8'))
  const results = Array.isArray(report.testResults) ? report.testResults : []
  const hasCleanUnhandledErrors = !Object.hasOwn(report, 'unhandledErrors') ||
    (Array.isArray(report.unhandledErrors) && report.unhandledErrors.length === 0)
  const valid = report?.success === true && Number.isInteger(report.numTotalTests) && report.numTotalTests > 0 &&
    Number.isInteger(report.numPassedTests) && Number.isInteger(report.numFailedTests) && Number.isInteger(report.numPendingTests) &&
    Number.isInteger(report.numFailedTestSuites) && report.numFailedTestSuites === 0 && report.numFailedTests === 0 &&
    executedTestStep.exitCode === 0 && executedTestStep.error == null && hasCleanUnhandledErrors && results.length > 0 &&
    results.every(result => result?.status === 'passed' || result?.status === 'pending')
  const filesPassed = results.filter(result => result?.status === 'passed').length
  const filesFailed = results.filter(result => result?.status === 'failed').length
  const unhandledErrors = Array.isArray(report.unhandledErrors) ? report.unhandledErrors.length : null
  testCounts = { passed: report.numPassedTests ?? null, failed: report.numFailedTests ?? null, skipped: report.numPendingTests ?? null,
    total: report.numTotalTests ?? null, filesPassed, filesFailed, unhandledErrors,
    runtimeErrorSignal: Object.hasOwn(report, 'unhandledErrors') ? 'vitest-json' : 'vitest-exit-code' }
  if (executedTestStep) {
    executedTestStep.ok = executedTestStep.ok && valid
    testReportError = valid ? null : 'TEST_REPORT_NOT_SUCCESSFUL'
    if (!executedTestStep.ok && !executedTestStep.error) executedTestStep.error = testReportError
  }
} } catch { /* missing or invalid JSON stays a failed test step */ }
if (executedTestStep && !testCounts) { executedTestStep.ok = false; executedTestStep.error ??= testReportError }

const ok = !setupError && steps.length > 0 && steps.every(step => step.ok)
const proof = { createdAt: new Date().toISOString(), checkpoint: checkpoint(), mode: args.has('--build') ? 'build' : 'verify',
  scriptDataPresent: hasScriptData, scriptCount: steps.find(step => step.id === 'verify-scripts')?.parsed ?? null,
  testCounts, setupError, steps: steps.map(({ id, ok, exitCode, error, durationMs, log, parsed }) => ({ id, ok, exitCode, error, durationMs, log, ...(parsed === undefined ? {} : { parsed }) })), ok }
try { await writeProof(proofFile, proof) } catch { console.error('Could not write verification proof under re/.'); process.exit(1) }
console.log(`Verify ${ok ? 'PASS' : 'FAIL'} | scripts ${proof.scriptCount ?? 'unavailable'}/82 | tests ${testCounts ? `${testCounts.passed ?? '?'} passed, ${testCounts.failed ?? '?'} failed, ${testCounts.skipped ?? '?'} skipped` : 'unavailable'} | ${steps.map(step => `${step.id} ${step.ok ? 'ok' : 'failed'} ${step.durationMs}ms`).join(' | ')} | proof ${proofFile}`)
if (!ok) process.exit(1)
