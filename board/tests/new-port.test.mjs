import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audit } from '../lib/audit.mjs'
import { parse } from '../lib/ledger.mjs'
import { scaffold } from '../new-port.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

test('new-port scaffolds a firewall-first repo whose ledger is clean and whose loop starts at research', () => {
  const base = mkdtempSync(join(tmpdir(), 'vnports-'))
  const projectsFile = join(base, 'projects.json')
  copyFileSync(join(HERE, '..', 'projects.json'), projectsFile)
  const agentsFile = join(base, 'AGENTS.md')
  writeFileSync(agentsFile, '| Say | Folder |\n|---|---|\n| Saya | `Saya no Uta\` |\n| a game not listed | - |\n')
  const target = scaffold({ base, id: 'testgame', full: 'Test Game', engine: 'KiriKiri', aliases: ['tg'], projectsFile, agentsFile })
  const md = readFileSync(join(target, 'docs', 'BACKLOG.md'), 'utf8')
  const items = parse(md)
  const fixes = audit(items, { md }).filter(f => f.level === 'fix')
  assert.deepEqual(fixes, [], 'a fresh ledger has nothing to fix')
  const out = execFileSync(process.execPath, [join(target, 'scripts', 'backlog.mjs'), 'next', '--agent', 'claude'], { encoding: 'utf8', cwd: target })
  assert.match(out, /^next: R2/m, 'R1 waits for the user (U1); R2 needs nothing')
  assert.match(execFileSync(process.execPath, [join(target, 'scripts', 'check-firewall.mjs')], { encoding: 'utf8', cwd: target }), /firewall: PASS/)
  assert.match(execFileSync('git', ['log', '--oneline'], { cwd: target, encoding: 'utf8' }), /New port: Test Game/)
  const cfg = JSON.parse(readFileSync(projectsFile, 'utf8'))
  assert.ok(cfg.projects.some(p => p.id === 'testgame' && p.aliases.includes('tg')))
  const agents = readFileSync(agentsFile, 'utf8')
  assert.ok(agents.indexOf('Test Game, tg') < agents.indexOf('a game not listed'), 'router row lands above the fallback row')
  assert.throws(() => scaffold({ base, id: 'testgame', full: 'Test Game', projectsFile, agentsFile }), /already/)
})
