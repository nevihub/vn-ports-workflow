#!/usr/bin/env node
// Start a new port - `npm run new-port -- <id> "<Full name>" ["<engine or ?>"] [--dir "<Folder name>"] [--aliases "a,b"]`
// (here or at the VN-Ports root). Creates VN-Ports\<Folder> with the firewall-first repo skeleton, a ledger whose
// timeline follows knowledge\PLAYBOOK.md (stages S0-S7) and seed research tickets, the `npm run issue` / `board` /
// `firewall` wrappers, a first local commit, the board entry (projects.json) and a router row in the root AGENTS.md.
// After that, "continue <game>" works like for every other port. Never touches game files.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VN_ROOT } from './lib/knowledge.mjs'
import { PROJECTS_FILE } from './lib/projects.mjs'

const today = () => new Intl.DateTimeFormat('sv-SE').format(new Date())

export function files ({ id, full, name, engine }) {
  const eng = engine && engine !== '?' ? engine : 'unknown yet'
  return {
    '.gitignore': ['# Game content never enters git (VN-Ports/AGENTS.md hard rules). Keep it in these folders.',
      'game-data/', 're/', 'ref/', 'private/', 'public/game/', 'dist/', 'node_modules/', '*.log', ''].join('\n'),
    '.gitattributes': '* text=auto eol=lf\n',
    'AGENTS.md': `# ${full} - browser port (${eng} engine)

Shared rules and the "continue <game>" work loop: \`<workflow-root>\\AGENTS.md\` - read it first
(this file only adds what is specific to ${name}). Stages and exit gates: \`VN-Ports\\knowledge\\PLAYBOOK.md\`.

## Game
- Edition and install path: unknown yet (ticket U1). Never modify the install; work on copies under ignored \`re/\`.
- Engine: ${eng}. Findings go to \`docs/DECISIONS.md\` (with PROVEN / STRONG / LEAD) and, once solid, to the
  engine's section in \`VN-Ports\\knowledge\\ENGINES.md\`.
- Goal: playable in a browser start to finish first, then phones and performance (\`knowledge\\DEFAULTS.md\`).

## Session start
\`HANDOFF.md\` top block, \`git status\`, \`git log -5\`, \`npm run issue -- goal\`, \`npm run firewall\`.

## Game-specific rules
- Game content lives only in \`game-data/\`, \`re/\`, \`ref/\`, \`private/\`, \`public/game/\`, \`dist/\` (all ignored).
  \`npm run firewall\` before every commit; extend \`scripts/check-firewall.mjs\` with this game's file types and
  a story-text check as soon as script strings can be extracted (Subahibi's firewall is the model).
`,
    'CLAUDE.md': '@AGENTS.md\n',
    'HANDOFF.md': `# HANDOFF: ${full} browser port (any agent)

Last updated ${today()} by new-port (scaffold). Keep this top block <= 60 lines; history goes to docs/HISTORY.md.

**Playable in a browser: not yet** (stage S0 Research). Progress % comes from the board (\`npm run issue -- goal\`).

## Now
- Repo created from the VN-Ports scaffold. Next: U1 (the user names the edition and install path), then R1/R2.

## Open questions for the user
- U1: which edition, and where is it installed?
`,
    'docs/DECISIONS.md': `# Decisions (${full})\n\nEach entry: date, decision, evidence (PROVEN / STRONG / LEAD), rejected alternative.\n`,
    'docs/HISTORY.md': `# History (${full})\n\nOld HANDOFF top blocks, newest first.\n`,
    'docs/BACKLOG.md': backlog({ full }),
    'package.json': JSON.stringify({
      name: `${id}-port`, private: true, version: '0.1.0', type: 'module',
      description: `Browser port of ${full}. Game files are supplied locally and never committed.`,
      scripts: { test: 'node --test tests/', issue: 'node scripts/backlog.mjs', board: 'node scripts/board.mjs', firewall: 'node scripts/check-firewall.mjs' },
    }, null, 2) + '\n',
    'scripts/backlog.mjs': wrapper(id, 'issue.mjs', '`npm run issue` - the shared VN-Ports ticket CLI on this checkout\'s docs/BACKLOG.md (`npm run issue -- help`).', true),
    'scripts/board.mjs': wrapper(id, 'board.mjs', '`npm run board` - opens the shared VN Ports board on this game.', false),
    'scripts/check-firewall.mjs': firewall(),
    'tests/firewall.test.mjs': `import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

test('the content firewall passes on the tracked files', () => {
  assert.match(execFileSync(process.execPath, ['scripts/check-firewall.mjs'], { encoding: 'utf8' }), /firewall: PASS/)
})
`,
  }
}

function wrapper (id, target, what, passRoot) {
  return `#!/usr/bin/env node
// ${what}
// The board lives in this repo under board/; games scaffolded inside it find it via ../board.
// Set VN_PORTS_BOARD to the board folder if the game repo lives elsewhere.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const candidates = [join(root, '..', 'board', '${target}'), join(root, 'board', '${target}')]
if (process.env.VN_PORTS_BOARD) candidates.unshift(join(process.env.VN_PORTS_BOARD, '${target}'))
candidates.push('__VN_PORTS_BOARD_BAKED__/${target}')
const shared = candidates.find(p => existsSync(p))
if (!shared) {
  console.error('the shared board was not found (../board, ./board, VN_PORTS_BOARD, or the baked-in path)')
  process.exit(1)
}
const r = spawnSync(process.execPath, [shared, '--project', '${id}'${passRoot ? ", '--root', root" : ''}, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true })
process.exit(r.status ?? 1)
`
}

function firewall () {
  return `#!/usr/bin/env node
// Content firewall (starter): fails when a file git would commit is game content - a forbidden folder, a game file
// type or an oversized blob. Matched names are printed, contents never. Extend FORBIDDEN_EXT with this engine's
// archive/script types, and add a story-text shingle check once script strings can be extracted (see Subahibi's
// scripts/check-firewall.mjs). Self-test: a planted path must be caught before the real check is trusted.
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FORBIDDEN_DIR = /^(game-data|re|ref|private|public\\/game|dist)\\//
const FORBIDDEN_EXT = /\\.(exe|dll|ogg|wav|mp3|m4a|aac|opus|jpg|jpeg|png|bmp|webp|avif|gif|tlg|mpg|mpeg|avi|wmv|mp4|webm|ttf|otf|pfs|arc|xp3|npa|dat|pak)$/i
const MAX_BYTES = 2 * 1024 * 1024
const bad = file => (FORBIDDEN_DIR.test(file) && 'forbidden-path') || (FORBIDDEN_EXT.test(file) && 'forbidden-extension') || null

if (bad('re/planted/sample.png') !== 'forbidden-path' || bad('src/a.ogg') !== 'forbidden-extension' || bad('src/a.ts')) {
  console.error('firewall: FAIL - self-test did not catch the planted fixture')
  process.exit(1)
}
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const list = [...new Set([...git(['ls-files', '-z', '--cached']).split('\\0'), ...git(['ls-files', '-z', '--others', '--exclude-standard']).split('\\0')].filter(Boolean))]
const violations = []
for (const file of list) {
  const rule = bad(file)
  if (rule) violations.push({ file, rule })
  const p = join(root, file)
  if (file !== 'package-lock.json' && existsSync(p) && statSync(p).size > MAX_BYTES) violations.push({ file, rule: 'oversized' })
}
if (violations.length) {
  for (const v of violations) console.error(\`firewall: \${v.rule}: \${v.file}\`)
  console.error(\`firewall: FAIL - \${violations.length} of \${list.length} files\`)
  process.exit(1)
}
console.log(\`firewall: PASS - \${list.length} files checked (self-test caught the planted fixture)\`)
`
}

function backlog ({ full }) {
  return `# ${full} - task ledger

Live ticket ledger, read by the shared VN Ports board. Update it only with \`npm run issue\` (\`npm run issue -- help\`).
Rules for every agent: \`<workflow-root>\\AGENTS.md\`. Stages follow \`knowledge\\PLAYBOOK.md\`.

## Timeline

### [S0] Research
Plain: Find out which game files we have, what engine runs them and what tools already exist.
Tickets: U1, R1, R2
Weight: 10

### [S1] Safe repo and extraction
Plain: Set up a project that can never leak game files, then read the game's archives with exact counts.
Tickets: E1, E2
Weight: 10

### [S2] Boots without a window
Plain: The game's own logic runs on the computer (no window) as far as the title screen.
Tickets: E3
Weight: 15

### [S3] Pictures and words right
Plain: Every screen draws like the real game - backgrounds, characters, words, effects.
Tickets:
Weight: 20

### [S4] Playable in a browser
Plain: You can play from the first screen to every ending in a browser, with sound, saves and menus.
Tickets:
Weight: 20
Playable: yes

### [S5] Phones and compatibility
Plain: It works well on phones (touch, iPhone sound, installable) and in every major browser.
Tickets:
Weight: 10

### [S6] Faster and smaller
Plain: Loads quickly and stays within phone memory.
Tickets:
Weight: 10

### [S7] Live
Plain: Ready to put online; you deploy it (agents never do).
Tickets:
Weight: 5

## Lanes

### Lane R — research

### [R1] Fingerprint the game files
Plain: List every file type in the game and identify the engine and its version.
Status: OPEN
Type: task
Prio: P1
Needs: U1
Gate: a fingerprint JSON in ignored re/ (engine, exe version, SHA-256 of key files, archive magics with counts and sizes) with zero unknown magics or an explicit list

### [R2] Find open runtimes, extractors and earlier ports
Plain: Look for existing tools that already understand this engine, and compare with what the other ports used.
Status: OPEN
Type: task
Prio: P1
Gate: a docs/DECISIONS.md entry naming the route (existing runtime to WASM, or our own VM), each claim labelled PROVEN / STRONG / LEAD, and the engine's section started in knowledge/ENGINES.md

### Lane E — engine

### [E1] Content firewall before any game-derived commit
Plain: Make sure no game file or story text can ever be committed.
Status: OPEN
Type: task
Prio: P1
Needs: R1
Gate: npm run firewall knows this engine's file types and catches a planted fixture; a story-text check is planned or in place

### [E2] Archive reader with a counted listing
Plain: Read the game's archives and prove every file inside was found.
Status: OPEN
Type: task
Prio: P1
Needs: R1, E1
Gate: entries found == the archive header counts for every archive; deterministic extraction into ignored re/

### [E3] Boot to the title screen headless
Plain: Run the game's own logic without a window until it reaches the title screen.
Status: OPEN
Type: task
Prio: P1
Needs: E2, R2
Gate: the title is reached headless; an unknown-opcode / built-in census prints 0 unknowns on the boot path

### Lane W — website

### Lane U — for you

### [U1] Which edition, and where is it installed?
Plain: Tell us which version of the game you have and the folder it is installed in.
Status: OPEN
Type: user
`
}

export function scaffold ({ base = VN_ROOT, id, full, engine = '?', dir, aliases = [], projectsFile = PROJECTS_FILE,
  agentsFile = join(VN_ROOT, 'AGENTS.md'), git = true } = {}) {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(id ?? '')) throw new Error('id: lowercase letters, digits and -, e.g. "sengoku"')
  if (!full) throw new Error('full name required, e.g. "Sengoku Rance"')
  const name = dir ?? full
  const target = join(base, name)
  if (existsSync(target) && readdirSync(target).length) throw new Error(`${target} already exists and is not empty`)
  const cfg = JSON.parse(readFileSync(projectsFile, 'utf8'))
  if (cfg.projects.some(p => p.id === id)) throw new Error(`projects.json already has "${id}"`)
  // Bake this script's own board folder into the wrappers as a last-resort fallback (same-machine
  // scaffolds). Clones on another machine use ../board or VN_PORTS_BOARD instead.
  const baked = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/')
  const out = files({ id, full, name, engine })
  for (const [rel, text] of Object.entries(out)) {
    const p = join(target, rel)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, text.replaceAll('__VN_PORTS_BOARD_BAKED__', baked))
  }
  cfg.projects.push({
    id, name: dir && dir !== full ? dir : full, full: `${full} (${engine && engine !== '?' ? `${engine} engine` : 'engine unknown yet'})`,
    aliases: [id, full.toLowerCase(), ...aliases.map(a => a.toLowerCase())], paths: [`../${name}`],
    lanes: { R: ['research', 'what the game is made of'], E: ['engine', "the game's inner machinery"], W: ['website', 'the page you play in'], U: ['for you', 'nobody else touches these'] },
    live: null, fallback: null,
    prompt: {
      start: 'Read <workflow-root>\\AGENTS.md (shared rules + the work loop), then {root}\\AGENTS.md and the HANDOFF.md top block. Then run `npm run issue -- show <ID>` for your ticket (it prints the card plus its Needs/Related one-liners and stage) - do not read the whole docs\\BACKLOG.md.',
      claimBy: '<agent>', lanes: {},
      rules: 'Game rules: npm run firewall before every commit; never print story text; never modify the install. Commit locally only - never push or deploy. When done: npm run issue -- done {id}, npm run issue -- audit, update HANDOFF.md.',
    },
    models: { '*': ['glm', 'sol', 'muse'], R: ['sol', 'opus', 'mimo'], E: ['sol', 'opus', 'mimo'], verify: ['glm', 'haiku', 'minimax'] },
  })
  writeFileSync(projectsFile, JSON.stringify(cfg, null, 2) + '\n')
  if (existsSync(agentsFile)) {
    const md = readFileSync(agentsFile, 'utf8')
    const row = `| ${[full, ...aliases].join(', ')} | \`${name}\\\` | ${engine && engine !== '?' ? engine : '?'} | \`AGENTS.md\`, \`HANDOFF.md\` top block | new port (scaffolded ${today()}); starts at S0 Research |`
    const at = md.indexOf('| a game not listed')
    if (at >= 0) writeFileSync(agentsFile, md.slice(0, at) + row + '\n' + md.slice(at))
  }
  if (git) {
    const run = args => execFileSync('git', args, { cwd: target, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    run(['init', '-q', '-b', 'main'])
    execFileSync(process.execPath, [join(target, 'scripts', 'check-firewall.mjs')], { cwd: target, stdio: 'pipe' })
    run(['add', '-A'])
    run(['commit', '-q', '-m', `New port: ${full} (VN-Ports scaffold)\n\nFirewall-first skeleton, ledger with the playbook timeline and seed research tickets.`])
  }
  return target
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const argv = process.argv.slice(2).filter(a => a !== '--')
  const flag = n => { const i = argv.indexOf(n); return i >= 0 ? argv.splice(i, 2)[1] : null }
  const dir = flag('--dir')
  const aliases = (flag('--aliases') ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const [id, full, engine] = argv
  if (!id || !full) {
    console.log('usage: npm run new-port -- <id> "<Full name>" ["<engine or ?>"] [--dir "<Folder name>"] [--aliases "a,b"]')
    process.exit(1)
  }
  try {
    const target = scaffold({ id, full, engine: engine ?? '?', dir, aliases })
    console.log(`new port: ${target}`)
    console.log('  ledger: docs/BACKLOG.md (stages S0-S7, tickets U1 R1 R2 E1 E2 E3), board entry and AGENTS.md router row added')
    console.log(`  next: tell an agent "continue ${full}" - it starts at S0 Research (U1 asks you for the edition and install path)`)
  } catch (e) { console.error(`new-port: ${e.message}`); process.exit(1) }
}
