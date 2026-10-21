import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as boardCfg from '../lib/game-config.mjs'
import * as templateCfg from '../../templates/scripts/lib/game-config.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES = join(HERE, '..', '..', 'templates')

// Files already migrated to game.config.json (P0-3). Each new migration appends its path here;
// the suite then holds it to the same bar: no hard-coded game, clean syntax, schema agreement.
const MIGRATED = [
  'scripts/lib/game-config.mjs',
  'scripts/check-firewall.mjs',
  'scripts/split-archives.mjs',
  'scripts/deploy.mjs',
  'scripts/verify.mjs',
  'scripts/check-deploy.mjs',
  'scripts/native-query.mjs',
  'scripts/make-pwa-icons.mjs',
  'scripts/check-shell-assets.mjs',
  'scripts/run-browser-check.mjs',
  'scripts/freeze-stack.mjs',
  'scripts/progress-report.mjs',
]

// TypeScript sources: same naming bar, validated with type-stripping --check (no resolve, parse only).
const MIGRATED_TS = [
  'scripts/shell-icons.ts',
  'scripts/pwa.ts',
  'vite.config.ts',
  'functions/_middleware.ts',
  'src/mobile/tips.ts',
]

// PowerShell scripts: same naming bar, but syntax is validated with the PS parser (win32) instead of node.
const MIGRATED_PS1 = ['scripts/native.ps1']

const good = () => ({
  version: 1,
  game: { id: 'sengoku', title: 'Sengoku Rance', edition: 'DLsite', engine: 'kirikiri' },
  runtime: { strategy: 'convert', openRuntime: null, license: null, note: 'x' },
  content: { archiveExtensions: ['xp3'], archiveNames: ['cg', 'voice'], archiveMagic: null,
    scriptExtensions: [], expectedScriptCount: 120, storyCorpus: null },
  qa: { titleChoices: 4, titleRoutine: 'TitleSelect' },
  build: { devPort: 5321, partSizeBytes: 1048576, renderWidth: 1280, renderHeight: 960 },
  native: { exePath: 'game.exe', sha256: 'a'.repeat(64), note: 'x' },
  deploy: { project: 'sengoku-port', domain: 'sengoku.example.net', branch: 'main', note: 'x' },
})

const freshScaffoldLike = () => {
  const cfg = good()
  cfg.game.edition = 'unknown yet (ticket U1)'
  cfg.content.archiveNames = []
  cfg.content.expectedScriptCount = null
  cfg.qa = {}
  cfg.native.exePath = null
  cfg.native.sha256 = null
  cfg.deploy.project = null
  cfg.deploy.domain = null
  return cfg
}

const corpus = () => {
  const cases = [good(), freshScaffoldLike()]
  const breaks = [
    c => { c.game.id = 'BAD ID' },
    c => { c.game.title = '<fill in>' },
    c => { c.runtime.strategy = 'rewrite' },
    c => { c.content.archiveExtensions = [] },
    c => { c.content.archiveNames = ['has space'] },
    c => { c.content.archiveMagic = 'zz' },
    c => { c.content.expectedScriptCount = 0 },
    c => { c.qa = 'nope' },
    c => { c.qa = { titleChoices: 0 } },
    c => { c.qa = { titleRoutine: 'TODO' } },
    c => { c.build.devPort = 80 },
    c => { c.build.partSizeBytes = 7 },
    c => { c.build.renderWidth = -1 },
    c => { c.version = 999 },
  ]
  for (const mutate of breaks) { const c = good(); mutate(c); cases.push(c) }
  return cases
}

test('board schema and template loader agree on every corpus config, strict and loose', () => {
  assert.equal(templateCfg.GAME_CONFIG_VERSION, boardCfg.GAME_CONFIG_VERSION, 'version constants stay in lockstep')
  for (const [index, cfg] of corpus().entries()) {
    for (const strict of [false, true]) {
      const a = boardCfg.validateGameConfig(cfg, { strict })
      const b = templateCfg.validateGameConfig(cfg, { strict })
      assert.deepEqual(b.errors, a.errors, `case ${index} strict=${strict}: errors agree`)
      assert.deepEqual(b.warnings, a.warnings, `case ${index} strict=${strict}: warnings agree`)
    }
  }
})

test('migrated template scripts name no game: no saya, hard-coded ext, port or domain', () => {
  for (const rel of MIGRATED) {
    const text = readFileSync(join(TEMPLATES, rel), 'utf8')
    assert.ok(!/saya/i.test(text), `${rel} still names the Saya game`)
    assert.ok(!/\.npa/i.test(text), `${rel} still hard-codes a .npa extension`)
    assert.ok(!/\b5317\b/.test(text), `${rel} still hard-codes the old dev port`)
    assert.ok(!/example\.com/i.test(text), `${rel} still carries a placeholder domain`)
    assert.ok(!/TitleSelect/.test(text), `${rel} still hard-codes the old title routine`)
  }
})

test('migrated template scripts read game.config.json and parse clean', () => {
  // progress-report.mjs reads only game.title (a report must render even before R1 validates the rest).
  const TITLE_ONLY = new Set(['scripts/progress-report.mjs'])
  for (const rel of MIGRATED) {
    if (rel.endsWith('lib/game-config.mjs') || TITLE_ONLY.has(rel)) continue
    const text = readFileSync(join(TEMPLATES, rel), 'utf8')
    assert.ok(text.includes('lib/game-config.mjs'), `${rel} does not load the per-game config`)
  }
  for (const rel of [...MIGRATED, ...TITLE_ONLY]) {
    const text = readFileSync(join(TEMPLATES, rel), 'utf8')
    assert.ok(text.includes('game-config') || text.includes('game.config.json'), `${rel} does not read the per-game config`)
  }
  for (const rel of MIGRATED) {
    execFileSync(process.execPath, ['--check', join(TEMPLATES, rel)], { stdio: ['ignore', 'pipe', 'pipe'] })
  }
  for (const rel of MIGRATED_TS) {
    const text = readFileSync(join(TEMPLATES, rel), 'utf8')
    assert.ok(!/saya/i.test(text), `${rel} still names the Saya game`)
    assert.ok(!/\.npa/i.test(text), `${rel} still hard-codes a .npa extension`)
    execFileSync(process.execPath, ['--experimental-strip-types', '--check', join(TEMPLATES, rel)],
      { stdio: ['ignore', 'pipe', 'pipe'] })
  }
  for (const rel of ['scripts/pwa.ts', 'vite.config.ts']) {
    assert.ok(readFileSync(join(TEMPLATES, rel), 'utf8').includes('game.config.json'), `${rel} does not read the per-game config`)
  }
  for (const rel of MIGRATED_PS1) {
    const text = readFileSync(join(TEMPLATES, rel), 'utf8')
    assert.ok(!/saya/i.test(text), `${rel} still names the Saya game`)
    assert.ok(text.includes('game.config.json'), `${rel} does not read the per-game config`)
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-Command',
        `$errs = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile(${JSON.stringify(join(TEMPLATES, rel))}, [ref]$null, [ref]$errs); $errs.Count`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      assert.equal(out.trim(), '0', `${rel} has PowerShell syntax errors`)
    }
  }
})

test('template derived() builds the names deploy and the cache layer share', () => {
  const d = templateCfg.derived(good())
  assert.equal(d.cacheName, 'sengoku-game-v1')
  assert.equal(d.ext, 'xp3')
  assert.deepEqual(d.archives, ['cg', 'voice'])
  assert.equal(d.devOrigin, 'http://127.0.0.1:5321')
  assert.equal(d.titleRoutine, 'TitleSelect')
  const bare = templateCfg.derived(freshScaffoldLike())
  assert.equal(bare.domain, null, 'placeholder domains read as absent so callers can demand --origin')
  assert.equal(bare.titleRoutine, null, 'unknown title routine reads as absent so checks skip it openly')
})

test('template loader refuses a missing config with a pointer, not a stack trace', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hy-'))
  assert.throws(() => templateCfg.requireGameConfig(dir), /GAME_NOT_CONFIGURED.*game\.config\.json/)
  writeFileSync(join(dir, 'game.config.json'), JSON.stringify(freshScaffoldLike()))
  assert.throws(() => templateCfg.requireGameConfig(dir, { production: true }), /GAME_NOT_CONFIGURED/)
  assert.throws(() => templateCfg.assertDeployable(freshScaffoldLike()), /DEPLOY_UNCONFIGURED:.*deploy\.project/)
  const ok = templateCfg.requireGameConfig(dir)
  assert.equal(ok.game.id, 'sengoku', 'dev-loop scripts run on warnings')
})

test('the manifest template is valid JSON with the title as its only placeholder', () => {
  const raw = readFileSync(join(TEMPLATES, 'public/manifest.webmanifest'), 'utf8')
  const manifest = JSON.parse(raw)
  assert.ok(!/saya/i.test(raw), 'manifest still names the Saya game')
  assert.ok(manifest.name.includes('game.config.json'), 'manifest points at the config for its title')
})

test('functions run only on game blocks: routes narrow, headers immutable-only for hashed assets', () => {
  const routes = JSON.parse(readFileSync(join(TEMPLATES, 'public/_routes.json'), 'utf8'))
  assert.equal(routes.version, 1)
  assert.ok(routes.include.length > 0 && routes.include.every(p => p.startsWith('/game/')),
    'every include stays under /game/* so static assets skip Functions entirely')
  assert.ok(!routes.include.includes('/*'), 'no bare /* include: static requests stay on the free allowance')
  // _routes.json wildcards match any number of segments; exclude wins over include.
  const matches = (pattern, path) =>
    new RegExp(`^${pattern.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(path)
  const routed = path => routes.include.some(p => matches(p, path)) && !routes.exclude.some(p => matches(p, path))
  assert.equal(routed('/game/cg.xp3.0'), true, 'split blocks run the middleware')
  assert.equal(routed('/game/parts.json'), true, 'the manifest revalidates through the middleware')
  assert.equal(routed('/assets/app-abc123.js'), false, 'hashed shell assets never invoke Functions')
  assert.equal(routed('/'), false, 'the page itself never invokes Functions')
  // _headers: immutable hashed assets, revalidating entry points, and no blanket /game rule that
  // would freeze the versioned manifest (the middleware owns game-block headers).
  const headers = readFileSync(join(TEMPLATES, 'public/_headers'), 'utf8')
  const rules = []
  let current = null
  for (const line of headers.split('\n')) {
    if (/^\s*(#|$)/.test(line)) continue
    if (/^\S/.test(line)) { current = { path: line.trim(), directives: [] }; rules.push(current) }
    else if (current) current.directives.push(line.trim())
  }
  assert.ok(rules.length >= 4, 'entry points and hashed assets each have a rule')
  const directiveFor = path => rules.filter(r => matches(r.path, path)).flatMap(r => r.directives).join(';')
  assert.ok(directiveFor('/assets/app-abc123.js').includes('immutable'), 'hashed assets cache for a year')
  assert.ok(directiveFor('/sw.js').includes('no-cache'), 'the worker script revalidates so a new deploy takes over')
  assert.ok(directiveFor('/').includes('no-cache'), 'the page revalidates')
  assert.ok(!rules.some(r => r.path === '/game/*' || r.path === '/game/'),
    'no blanket game rule: parts.json must revalidate through the middleware')
  const mw = readFileSync(join(TEMPLATES, 'functions/_middleware.ts'), 'utf8')
  assert.ok(!/\.npa/i.test(mw), 'middleware matches the block shape, not an extension')
  assert.ok(/immutable/.test(mw) && /no-store/.test(mw), 'blocks immutable, everything else uncached')
})

test('template firewall reads game exts from config and catches planted story text', () => {
  process.env.GIT_AUTHOR_NAME ??= 'hygiene-test'
  process.env.GIT_AUTHOR_EMAIL ??= 'hygiene-test@example.com'
  process.env.GIT_COMMITTER_NAME ??= 'hygiene-test'
  process.env.GIT_COMMITTER_EMAIL ??= 'hygiene-test@example.com'
  const dir = mkdtempSync(join(tmpdir(), 'hy-fw-'))
  const cfg = good()
  cfg.content.archiveExtensions = ['xp3']
  cfg.content.scriptExtensions = ['xp3']
  writeFileSync(join(dir, 'game.config.json'), JSON.stringify(cfg))
  const scripts = join(dir, 'scripts')
  cpSync(join(TEMPLATES, 'scripts'), scripts, { recursive: true })
  writeFileSync(join(dir, '.gitignore'), 'game-data/\nre/\ndist/\npublic/game/\n')
  mkdirSync(join(dir, 'game-data', 'xp3'), { recursive: true })
  const canary = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu'
  writeFileSync(join(dir, 'game-data', 'xp3', 'story.xp3'), `<PRE>${canary}</PRE>`)
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const fw = () => spawnSync(process.execPath, [join(scripts, 'check-firewall.mjs')],
    { encoding: 'utf8', cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
  git('init', '-q', '-b', 'main')
  git('add', '-A')
  git('commit', '-q', '-m', 'skeleton')
  const clean = fw()
  assert.equal(clean.status, 0, clean.stderr)
  assert.match(clean.stdout, /Firewall PASS/, 'corpus present and no leak')
  assert.match(clean.stdout, /1 blocks/, 'the corpus shingles were built')
  writeFileSync(join(dir, 'notes.txt'), `header\n\n${canary}\n`)
  const dirty = fw()
  assert.notEqual(dirty.status, 0, 'leaked story text fails')
  assert.match(dirty.stdout, /story-text: notes\.txt/, 'the leak names the file, never its text')
  assert.ok(!dirty.stdout.includes(canary), 'matched text is never printed')
})

test('migrated deploy/split scripts run against a fixture game checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hy-game-'))
  const cfg = good()
  cfg.build.partSizeBytes = 65536
  writeFileSync(join(dir, 'game.config.json'), JSON.stringify(cfg))
  const scripts = join(dir, 'scripts')
  cpSync(join(TEMPLATES, 'scripts'), scripts, { recursive: true })
  const run = (script, args) => {
    const r = spawnSync(process.execPath, [join(scripts, script), ...args],
      { encoding: 'utf8', cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] })
    if (r.status !== 0) throw Object.assign(new Error(`${script} exited ${r.status}: ${r.stderr}${r.stdout}`), { stdout: r.stdout, stderr: r.stderr })
    return `${r.stdout}${r.stderr}`
  }
  assert.match(run('deploy.mjs', ['--dry-run']), /project sengoku-port, branch main/,
    'dry-run plans the configured project, not the old game')
  assert.match(run('check-deploy.mjs', ['--help']), /sengoku\.example\.net/,
    'smoke help defaults to the configured domain')
  // Archives with 64 KiB parts split into `<name>.<ext>.0|1` plus a manifest.
  mkdirSync(join(dir, 'dist', 'game'), { recursive: true })
  writeFileSync(join(dir, 'dist', 'game', 'cg.xp3'), Buffer.alloc(70000, 7))
  writeFileSync(join(dir, 'dist', 'game', 'voice.xp3'), Buffer.alloc(1000, 9))
  run('split-archives.mjs', [])
  const manifest = JSON.parse(readFileSync(join(dir, 'dist', 'game', 'parts.json'), 'utf8'))
  assert.equal(manifest.partSize, 65536)
  assert.deepEqual(manifest.sizes, { cg: 70000, voice: 1000 })
  assert.match(manifest.version, /^[a-f0-9]{12}$/)
  assert.match(run('deploy.mjs', ['--dry-run', '--prepared']), /Deploy preflight PASS.*project sengoku-port/,
    'the split output passes the same validation a real deploy runs')
  assert.match(run('native-query.mjs', ['--help']), /game\.config\.json/,
    'RE tooling usage names the config, not an executable')
  assert.match(run('make-pwa-icons.mjs', []), /not found at/,
    'missing executable warns and keeps existing icons instead of failing the build')
})
