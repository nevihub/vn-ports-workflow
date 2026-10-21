import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { post, read as readChannel } from '../lib/channel.mjs'
import { runSweep } from '../maintainer-sweep.mjs'

const SWEEP = fileURLToPath(new URL('../maintainer-sweep.mjs', import.meta.url))

test('maintainer-sweep --help explains itself and changes nothing', () => {
  const out = execFileSync(process.execPath, [SWEEP, '--help'], { encoding: 'utf8' })
  assert.match(out, /Dry run by default/)
  assert.match(out, /--post/)
})

test('maintainer-sweep rejects an unknown project', () => {
  try {
    execFileSync(process.execPath, [SWEEP, '--project', 'no-such-game'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    assert.fail('should have exited non-zero')
  } catch (e) {
    assert.match(String(e.stderr ?? e.message), /unknown --project/)
  }
})

const fixture = prefix => mkdtempSync(join(tmpdir(), prefix))
const removeFixture = path => {
  const base = resolve(tmpdir()) + sep
  const target = resolve(path)
  if (!target.startsWith(base)) throw new Error('refusing to remove a test path outside the temporary directory')
  rmSync(target, { recursive: true, force: true })
}
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore', windowsHide: true })

function projectFixture (id, ticket) {
  const root = fixture(`vn-sweep-${id}-`)
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'BACKLOG.md'), [
    '# Backlog', '', '## Timeline', '', '### [S1] Fixture stage', `Tickets: ${ticket}`, 'Weight: 100', 'Playable: yes',
    '', '## Lanes', '', '### Lane E', '', `### [${ticket}] Fixture task`, 'Plain: fixture task', 'Gate: fixture check',
    `Status: CLAIMED by fixture-${id}, 2026-10-20 06:00`, '',
  ].join('\n'))
  git(root, 'init', '-b', 'main')
  git(root, 'config', 'user.email', 'fixture@example.invalid')
  git(root, 'config', 'user.name', 'Fixture')
  git(root, 'add', '.')
  git(root, 'commit', '-m', 'fixture baseline')
  return { id, name: id, root, lanes: { E: ['engine', 'engine'], U: ['user', 'user'] }, oracles: [] }
}

test('sweep preserves goal numbers and project/channel order, deduplicates nudges, and keeps dry runs silent', () => {
  const alpha = projectFixture('alpha', 'E1')
  const beta = projectFixture('beta', 'E2')
  const channelDir = fixture('vn-sweep-channel-')
  const now = Date.parse('2026-10-20T18:00:00Z')
  try {
    const alphaOriginal = { channel: 'alpha', by: 'fixture', kind: 'note', text: 'alpha early', at: now - 180_000 }
    const betaNudge = { channel: 'beta', by: 'maintainer fixture', kind: 'question', ticket: 'E2', text: 'maintainer nudge: E2 checked', at: now - 120_000 }
    const allLater = { channel: 'all', by: 'fixture', kind: 'heads-up', text: 'shared later', at: now - 60_000 }
    for (const msg of [alphaOriginal, betaNudge, allLater]) {
      post(msg, { dir: channelDir, now: msg.at })
    }
    const before = Object.fromEntries(['alpha', 'beta', 'all'].map(name => [name, readFileSync(join(channelDir, `${name}.jsonl`), 'utf8')]))
    const postCalls = []
    const dry = runSweep({ args: ['--limit', '10'], projects: [beta, alpha], now, channelDir,
      postMessage: (...args) => { postCalls.push(args); throw new Error('dry run posted') } })
    assert.equal(dry.exitCode, 0)
    assert.deepEqual(postCalls, [])
    assert.match(dry.output, /Dry run \(no posts\)\./)
    assert.ok(dry.output.indexOf('=== beta ===') < dry.output.indexOf('=== alpha ==='))
    assert.match(dry.output, /Overall: 0%/)
    assert.match(dry.output, /You are here: \[S1\] Fixture stage - 0%/)
    assert.match(dry.output, /E2 claimed by fixture-beta/)
    assert.match(dry.output, /would nudge E1/)
    assert.doesNotMatch(dry.output, /would nudge E2/)
    assert.ok(dry.output.indexOf('2026-10-20') >= 0)
    const betaSection = dry.output.slice(dry.output.indexOf('=== beta ==='), dry.output.indexOf('=== alpha ==='))
    assert.ok(betaSection.indexOf('beta checked') < betaSection.indexOf('shared later'))
    for (const name of ['alpha', 'beta', 'all']) assert.equal(readFileSync(join(channelDir, `${name}.jsonl`), 'utf8'), before[name])

    const posted = runSweep({ args: ['--post', '--by', 'fixture maintainer', '--limit', '10'], projects: [beta, alpha], now, channelDir })
    assert.equal(posted.exitCode, 0)
    assert.equal(readChannel('beta', { dir: channelDir }).filter(m => m.by === 'fixture maintainer').length, 1)
    assert.equal(readChannel('alpha', { dir: channelDir }).filter(m => m.by === 'fixture maintainer').length, 2)
    assert.equal(readChannel('beta', { dir: channelDir }).filter(m => /maintainer nudge/i.test(m.text)).length, 1)
    assert.equal(readChannel('alpha', { dir: channelDir }).filter(m => /maintainer nudge/i.test(m.text)).length, 1)
  } finally {
    removeFixture(alpha.root)
    removeFixture(beta.root)
    removeFixture(channelDir)
  }
})

test('sweep reports posting failures with a failing exit code', () => {
  const project = projectFixture('failure', 'E9')
  const channelDir = fixture('vn-sweep-failure-channel-')
  try {
    const result = runSweep({ args: ['--post'], projects: [project], channelDir, now: Date.parse('2026-10-20T18:00:00Z'),
      postMessage: () => { throw new Error('fixture post failure') } })
    assert.equal(result.exitCode, 1)
    assert.ok(result.errors.length > 0)
    assert.match(result.errors[0], /fixture post failure/)
  } finally {
    removeFixture(project.root)
    removeFixture(channelDir)
  }
})

test('sweep reports unavailable configured projects and exits non-zero instead of skipping them', () => {
  const unavailable = { id: 'unavailable', name: 'Unavailable', root: null, lanes: {}, oracles: [] }
  const missingRoot = fixture('vn-sweep-missing-ledger-')
  const healthy = projectFixture('healthy', 'E1')
  try {
    const result = runSweep({ args: ['--project', 'all'], projects: [unavailable,
      { id: 'missing-ledger', name: 'Missing ledger', root: missingRoot, lanes: {}, oracles: [] }, healthy] })
    assert.equal(result.exitCode, 1)
    assert.match(result.output, /=== unavailable ===\nerror: project checkout is unavailable/)
    assert.match(result.output, /=== missing-ledger ===\nerror: docs\/BACKLOG\.md is unavailable/)
    assert.match(result.output, /=== healthy ===/)
  } finally {
    removeFixture(missingRoot)
    removeFixture(healthy.root)
  }
})
