import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertDeployable, GAME_CONFIG_VERSION, loadGameConfig, validateGameConfig } from '../lib/game-config.mjs'

const good = () => ({
  version: 1,
  game: { id: 'sengoku', title: 'Sengoku Rance', edition: 'DLsite', engine: 'kirikiri' },
  runtime: { strategy: 'convert', openRuntime: null, license: null, note: 'x' },
  content: { archiveExtensions: ['xp3'], archiveNames: ['cg', 'voice'], scriptExtensions: [], expectedScriptCount: 120, storyCorpus: null },
  build: { devPort: 5321, partSizeBytes: 1048576, renderWidth: 1280, renderHeight: 960 },
  native: { exePath: 'game.exe', sha256: 'a'.repeat(64), note: 'x' },
  deploy: { project: 'sengoku-port', domain: 'sengoku.example.net', branch: 'main', note: 'x' },
})

test('a complete config validates clean in both modes', () => {
  assert.deepEqual(validateGameConfig(good()), { errors: [], warnings: [] })
  assert.deepEqual(validateGameConfig(good(), { strict: true }), { errors: [], warnings: [] })
})

test('fresh-scaffold values warn but pass non-strict, refuse strict deploy', () => {
  const cfg = good()
  cfg.game.edition = 'unknown yet (ticket U1)'
  cfg.content.archiveNames = []
  cfg.deploy.project = null
  cfg.deploy.domain = null
  const loose = validateGameConfig(cfg)
  assert.deepEqual(loose.errors, [], 'a fresh scaffold must not fail plain validation')
  assert.ok(loose.warnings.some(w => w.startsWith('deploy.project')), 'missing project warns')
  const strict = validateGameConfig(cfg, { strict: true })
  assert.ok(strict.errors.some(e => e.startsWith('deploy.project')), 'production refuses a placeholder project')
  assert.ok(strict.errors.some(e => e.startsWith('deploy.domain')), 'production refuses a placeholder domain')
  assert.throws(() => assertDeployable(cfg), /DEPLOY_UNCONFIGURED/, 'assertDeployable names the missing values')
})

test('bad ids, engines, strategies and ports are errors', () => {
  const badId = good(); badId.game.id = 'Sengoku!'
  assert.ok(validateGameConfig(badId).errors.some(e => e.startsWith('game.id')), 'rejects a non-slug id')
  const noTitle = good(); noTitle.game.title = '<fill in>'
  assert.ok(validateGameConfig(noTitle).errors.some(e => e.startsWith('game.title')), 'rejects a placeholder title')
  const badStrategy = good(); badStrategy.runtime.strategy = 'rewrite'
  assert.ok(validateGameConfig(badStrategy).errors.some(e => e.startsWith('runtime.strategy')), 'rejects an unknown strategy')
  const badExt = good(); badExt.content.archiveExtensions = []
  assert.ok(validateGameConfig(badExt).errors.length > 0, 'rejects an empty extension list')
  const badPort = good(); badPort.build.devPort = 80
  assert.ok(validateGameConfig(badPort).errors.some(e => e.startsWith('build.devPort')), 'rejects a privileged port')
  const badCount = good(); badCount.content.expectedScriptCount = 0
  assert.ok(validateGameConfig(badCount).errors.some(e => e.startsWith('content.expectedScriptCount')), 'rejects a non-positive count')
})

test('version bumps and non-objects are errors, not crashes', () => {
  assert.ok(validateGameConfig({ ...good(), version: 999 }).errors.some(e => e.includes('version')), 'rejects a newer version')
  assert.ok(validateGameConfig(null).errors.length > 0, 'rejects null')
  assert.ok(validateGameConfig([]).errors.length > 0, 'rejects an array')
})

test('loadGameConfig reports a missing file instead of throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
  const missing = loadGameConfig(dir)
  assert.equal(missing.config, null)
  assert.ok(missing.errors.some(e => e.includes('game.config.json')), 'points at the scaffold step')
  writeFileSync(join(dir, 'game.config.json'), '{not json')
  const broken = loadGameConfig(dir)
  assert.equal(broken.config, null, 'unparsable config loads as null')
})

test('loadGameConfig round-trips a written config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
  writeFileSync(join(dir, 'game.config.json'), JSON.stringify(good()))
  const { config, errors } = loadGameConfig(dir)
  assert.deepEqual(errors, [])
  assert.equal(config.game.id, 'sengoku')
  assert.equal(GAME_CONFIG_VERSION, 1, 'the version constant matches the fixture')
})
