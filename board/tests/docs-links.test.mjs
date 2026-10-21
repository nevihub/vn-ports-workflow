import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const read = p => readFileSync(join(ROOT, p), 'utf8')

test('the cold-start path exists and orders the canonical loop without duplicating it', () => {
  const start = read('docs/AGENT-START.md')
  const steps = [...start.matchAll(/^(\d+)\. /gm)].map(m => Number(m[1]))
  assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'exactly the 10 advertised steps, in order')
  for (const anchor of ['AGENTS.md', 'HANDOFF.md', 'npm run doctor', 'issue -- goal', 'issue -- next',
    'claim', 'Gate:', 'firewall', 'audit', 'HANDOFF.md', 'rescue', 'recovery', 'reviewed',
    'knowledge/DEFAULTS.md', 'knowledge/LESSONS.md', 'npm run kb']) {
    assert.ok(start.includes(anchor), `cold start points at the canonical ${anchor}`)
  }
  assert.ok(!/## Shared hard rules/.test(start), 'rules stay in AGENTS.md; the entrypoint only references them')
})

test('every entrypoint-linked file the docs promise actually exists', () => {
  const candidates = new Set()
  for (const doc of ['docs/AGENT-START.md', 'README.md', 'docs/CHECKLIST.md', 'AGENTS.md']) {
    const text = read(doc)
    for (const m of text.matchAll(/`((?:docs|knowledge|board|templates|scripts|examples)\/[^`]+?)`/g)) {
      candidates.add(m[1].replace(/\/$/, ''))
    }
  }
  assert.ok(candidates.size > 5, 'the docs link enough siblings to make the check real')
  for (const c of candidates) {
    const base = c.split(/[?#]/)[0].replace(/\/+$/, '')
    if (/^(knowledge\/templates\/|Saya |subahibi-port-kit)/.test(base)) continue // illustrative / external references
    // Per-game files: the workflow repo holds the loop, each game checkout holds its ledger.
    if (/^(docs\/(DECISIONS|HISTORY|BACKLOG)\.md|HANDOFF\.md)$/.test(base)) continue
    assert.ok(existsSync(join(ROOT, base)), `${base} (linked from the entrypoint docs) exists`)
  }
  assert.ok(read('README.md').includes('docs/AGENT-START.md'), 'the README hands agents the cold-start file')
  assert.match(read('README.md'), /Clone `<repo-url>`, `cd <game-folder>`/, 'the README has the copy-paste agent prompt')
  assert.ok(!read('README.md').includes('(private)'), 'the public repo no longer calls itself private')
})

test('the per-ticket checklist matches the enforced gates', () => {
  const checklist = read('docs/CHECKLIST.md')
  for (const gate of ['--waive-proof', '--user-ok', 'Needs:', 'never the checker', 'rescue', 'recovery']) {
    assert.ok(checklist.includes(gate), `checklist states the ${gate} rule the CLI enforces`)
  }
})

test('stage gates wire proof freshness instead of trusting old stamps', () => {
  const playbook = read('knowledge/PLAYBOOK.md')
  assert.ok(playbook.includes('npm run check-proofs -- --strict'), 'playbook names the freshness Proof wiring')
  for (const state of ['fresh', 'stale', 'untraceable', 'missing']) {
    assert.ok(playbook.includes(`\`${state}\``), `playbook defines the ${state} proof state`)
  }
})

test('the route decision and engine surface docs exist and agree with the loop', () => {
  const route = read('docs/ROUTE-DECISION.md')
  for (const col of ['open engine to WASM', 'own VM', 'offline IR conversion']) {
    assert.ok(route.includes(col), `route comparison covers ${col}`)
  }
  assert.ok(route.includes('Decision procedure'), 'the choice is a measurement order, not taste')
  assert.ok(read('docs/PORTING-GUIDE.md').includes('docs/ROUTE-DECISION.md'), 'the porting guide points at the third route')
  const caps = read('docs/ENGINE-CAPABILITIES.md')
  for (const fn of ['detect', 'extract', 'decode', 'controlFlow', 'execute', 'assets', 'save', 'verify']) {
    assert.match(caps, new RegExp(`\`${fn}[(\`]`, 'm'), `the surface names ${fn}`)
  }
})
