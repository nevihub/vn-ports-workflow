# templates/ — what to copy and what to change

This is also where shared browser pieces get lifted once a third port needs them (`LESSONS.md` §7).

Copied from the Saya repo (tracked source only, no game content). Copy into the new repo at the same
relative path. Per-game values live in `game.config.json` (written by the scaffold, filled in R1/U1) and
every script below reads them through `scripts/lib/game-config.mjs` — do not re-hard-code them.
The hygiene suite holds the migrated scripts to that bar (no game names, extensions, ports, or domains;
syntax-checked; placeholders refuse on production paths). To catch new leftovers, search the copied
scripts for the old game's markers (`saya`, `.npa`, `5317`, `example.com`);
`docs/progress-checklist.json` is the worked Saya sample and is exempt on purpose.

| File | Purpose | Change |
|---|---|---|
| `game.config.json` | the only per-game file: ids, engine, archive/script types, counts, ports, project | fill R1 (archives, exe SHA, strategy), U1 (edition, domain); nothing else is edited per game |
| `.gitignore`, `.gitattributes` | keep game content out of git | already covers common engine archives; R1 narrows nothing here (the firewall is the enforcer) |
| `scripts/check-firewall.mjs` | fails on game paths/extensions/large blobs/story text | `loadStoryText()` must read decompiled scenario strings instead of `<PRE>` blocks (E1); extension list already comes from the config |
| `scripts/lib/automation.mjs`, `scripts/lib/game-config.mjs` | repo root, CLI resolution, proofs; config loader + derived names | env names are `GAME_*` already; keep the board schema and the template loader in lockstep (hygiene test asserts it) |
| `scripts/verify.mjs` | tests + parse-all + tsc → `re/verification/verify.json` | none: the script-count assertion reads `content.expectedScriptCount` (null skips it until S1) |
| `scripts/run-browser-check.mjs`, `scripts/freeze-stack.mjs` | Playwright runner, stamped proofs; CDP freeze stacks | none: dev origin comes from `build.devPort` |
| `scripts/check-proofs.mjs` | proof freshness (commit + mtime) | checklist path only; wire `--strict` into each S-gate `Proof:` |
| `scripts/progress-report.mjs`, `docs/progress-checklist.json` | weighted, proof-scored progress % | rewrite the checklist items for the new game; report titles already come from the config |
| `scripts/shortcut-cards.mjs` | one card per `shortcut:` comment with related evidence | address pattern if needed |
| `scripts/native-query.mjs`, `scripts/native.ps1` | cached REA/Ghidra decompiles keyed by exe digest; background native capture | none: exe path/SHA render size come from `native.*` + `build.render*` |
| `scripts/make-pwa-icons.mjs`, `scripts/extract-game-icon.ps1` | icons from the exe icon | none: exe resolves from argv, `GAME_GAME_DIR`, or `native.exePath` |
| `scripts/masked-view.py` | view scripts with prose masked | rewrite the masking for the decompiled scenario text format |
| `scripts/compare-shots.py` | deterministic native-vs-port screenshot numbers | box geometry (`BOX`, `BG_*`) for the new render size; 800x600 is the old default |
| `tools/x86dis.py` | fast capstone disassembly queries | none (generic PE x86) |
| `scripts/split-archives.mjs` | split into blocks + `parts.json` with a content version | none: extension and block size come from the config |
| `scripts/deploy.mjs`, `check-deploy.mjs`, `check-shell-assets.mjs` | build → deploy → smoke/byte checks | none: project, domain, cache name, archives, title assertions all come from the config |
| `functions/_middleware.ts`, `public/_routes.json`, `public/_headers` | Pages cache headers | none: routes already cover only `/game/*`, headers cache hashed assets and revalidate entry points |
| `scripts/pwa.ts`, `scripts/shell-icons.ts`, `public/manifest.webmanifest` | PWA shell, SW, fallback icons, manifest | manifest `name`/`short_name` from the config title; cache prefix follows `game.id` |
| `src/mobile/*` | touch input, held skip, safe-area layout, first-run tips | shortcut keys the game registers; 4:3 still fits 1280×960; storage key is origin-scoped already |
| `src/archive/sha256.ts` | portable SHA-256 for non-secure contexts | none |
| `tsconfig.json`, `vite.config.ts` | strict TS, Vite (ignores `**/re/**` in watch) | none: the port comes from `build.devPort` |
| `docs/recipes/` | optional workflow recipes from addyosmani/agent-skills (MIT): debugging, TDD, doubt-driven review. Not auto-enabled; copy only into projects that need them | none; apply the overrides in its README |
