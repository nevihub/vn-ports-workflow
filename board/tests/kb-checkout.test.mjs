import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The shipped projects.json is empty, so run kb.mjs from a fixture workspace with one configured project.
const HERE = fileURLToPath(new URL('..', import.meta.url))
const project = 'fixture'
let cli
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', windowsHide: true })

test('kb --root uses the selected checkout and preserves the document allowlist', () => {
  const base = mkdtempSync(join(tmpdir(), 'vn-kb-checkout-'))
  const main = join(base, 'main')
  const worktree = join(base, 'worktree')
  const ws = join(base, 'ws')
  cpSync(join(HERE, 'kb.mjs'), join(ws, 'board', 'kb.mjs'))
  cpSync(join(HERE, 'lib'), join(ws, 'board', 'lib'), { recursive: true })
  cpSync(join(HERE, '..', 'AGENTS.md'), join(ws, 'AGENTS.md'))
  cpSync(join(HERE, '..', 'knowledge', 'DEFAULTS.md'), join(ws, 'knowledge', 'DEFAULTS.md'))
  writeFileSync(join(ws, 'board', 'projects.json'), JSON.stringify({ projects: [{ id: project, name: 'Fixture', paths: [join(base, 'configured')] }] }))
  mkdirSync(join(base, 'configured'))
  cli = join(ws, 'board', 'kb.mjs')
  const marker = 'kbcheckoutregressionmarker'
  for (const [root, state] of [[main, 'MAIN'], [worktree, 'WORKTREE']]) {
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'HANDOFF.md'), `${marker} ${state} handoff\n`)
    writeFileSync(join(root, 'docs', 'DECISIONS.md'), `${marker} ${state} decision\n`)
    writeFileSync(join(root, 'docs', 'BACKLOG.md'), `${marker} ${state} ledger\n`)
    writeFileSync(join(root, 'docs', 'notes.md'), `${marker} EXCLUDED\n`)
    for (const dir of ['game-data', 're', 'private', 'media', 'engine']) {
      mkdirSync(join(root, dir))
      writeFileSync(join(root, dir, 'HANDOFF.md'), `${marker} EXCLUDED\n`)
    }
  }
  for (const [root, state, other] of [[main, 'MAIN', 'WORKTREE'], [worktree, 'WORKTREE', 'MAIN']]) {
    const result = run(marker, '--project', project, '--root', root)
    assert.equal(result.status, 0, result.stderr)
    for (const kind of ['handoff', 'decision', 'ledger']) assert.ok(result.stdout.includes(`${state} ${kind}`))
    assert.ok(result.stdout.includes('3 hit(s)'))
    assert.ok(!result.stdout.includes(other))
    assert.ok(!result.stdout.includes('EXCLUDED'))
  }
  const shared = run('Standing defaults', '--project', project, '--root', worktree)
  assert.equal(shared.status, 0, shared.stderr)
  assert.match(shared.stdout, /\[knowledge\].*DEFAULTS\.md/)
  const original = run(marker, '--project', project)
  assert.equal(original.status, 0, original.stderr)
  assert.match(original.stdout, /0 hit\(s\)/)

  for (const args of [
    [marker, '--root', worktree],
    [marker, '--project', 'unknown-project', '--root', worktree],
    [marker, '--project', project, '--root', join(base, 'missing')],
    [marker, '--project', project, '--root', join(worktree, 'HANDOFF.md')],
    [marker, '--project', project, '--root'],
    [marker, '--project', '--root', worktree],
  ]) {
    const result = run(...args)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /--root/)
    assert.ok(!result.stdout.includes('hit(s)'), 'invalid overrides must not silently search the main checkout')
  }
})
