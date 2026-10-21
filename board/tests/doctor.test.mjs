import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaffold } from '../new-port.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
process.env.GIT_AUTHOR_NAME ??= 'doctor-test'
process.env.GIT_AUTHOR_EMAIL ??= 'doctor-test@example.com'
process.env.GIT_COMMITTER_NAME ??= 'doctor-test'
process.env.GIT_COMMITTER_EMAIL ??= 'doctor-test@example.com'

function makeGame (id) {
  const base = mkdtempSync(join(tmpdir(), 'dr-'))
  const projectsFile = join(base, 'projects.json')
  copyFileSync(join(HERE, '..', 'projects.json'), projectsFile)
  const agentsFile = join(base, 'AGENTS.md')
  writeFileSync(agentsFile, '| Say | Folder |\n| a game not listed | - |\n')
  return scaffold({ base, id, full: `Doctor ${id}`, engine: 'KiriKiri', projectsFile, agentsFile, git: false })
}

const doctor = (target, args) => execFileSync(process.execPath, [join(HERE, '..', 'doctor.mjs'), '--root', target, ...args],
  { encoding: 'utf8', cwd: target, stdio: ['ignore', 'pipe', 'pipe'] })

test('a fresh scaffold is doctor READY: required checks pass, stage tooling warns', () => {
  const target = makeGame('ready')
  const report = JSON.parse(doctor(target, ['--json']))
  assert.equal(report.ok, true, `required failures: ${report.failed.join(', ')}`)
  assert.equal(report.project, null, 'unregistered fixture has no board project')
  const ids = new Map(report.checks.map(c => [c.id, c]))
  assert.equal(ids.get('game-config').ok, true, 'the scaffold config validates')
  assert.equal(ids.get('script:check-firewall.mjs').ok, true)
  assert.equal(ids.get('script:verify.mjs').tier, 'recommended', 'stage scripts arrive later')
  const text = doctor(target, [])
  assert.match(text, /doctor READY/)
})

test('a broken config fails the required tier with a pointer', () => {
  const target = makeGame('broken')
  writeFileSync(join(target, 'game.config.json'), '{"version": 1}')
  assert.throws(() => doctor(target, ['--json']), /game-config|NOT READY|doctor/i)
  try {
    doctor(target, [])
    assert.fail('doctor must exit non-zero on a broken config')
  } catch (e) {
    assert.match(e.stdout + e.stderr, /NOT READY|game-config/)
  }
})

test('the scaffolded doctor wrapper reaches the board doctor', () => {
  const target = makeGame('wrap')
  const out = execFileSync(process.execPath, [join(target, 'scripts', 'doctor.mjs'), '--json'],
    { encoding: 'utf8', cwd: target, stdio: ['ignore', 'pipe', 'pipe'] })
  assert.match(out, /"game-config"/, 'the wrapper forwards to board/doctor.mjs')
})
