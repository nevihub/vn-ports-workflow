import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..', '..')
const yml = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')

test('CI runs the whole gate on two node versions with no secrets, games, or OS-only tools', () => {
  assert.ok(yml.includes("'20'") && yml.includes("'22'"), 'node 20 + 22 matrix')
  assert.ok(yml.includes('ubuntu-latest'), 'linux runner (no Windows-only tooling)')
  assert.match(yml, /run:\s*npm test/, 'full suite runs in CI')
  assert.ok(yml.includes('--check'), 'syntax sweep runs in CI')
  for (const journey of ['new-port', 'proof-freshness', 'template-hygiene', 'firewall-gates']) {
    assert.ok(yml.includes(journey), `the ${journey} fixture journey runs in CI by name`)
  }
  assert.ok(!yml.includes('${{ secrets.'), 'no secrets referenced')
  assert.ok(!/game-data|public\/game/.test(yml), 'no game data paths referenced')
  assert.ok(yml.includes('actions/checkout@v4') && yml.includes('actions/setup-node@v4'), 'pinned checkout + setup-node')
})
