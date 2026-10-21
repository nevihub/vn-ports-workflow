# knowledge/templates/ — what to copy and what to change

This is also where shared browser pieces get lifted once a third port needs them (`LESSONS.md` §7).

Copied verbatim from the Saya repo (tracked source only, no game content). Copy into the new repo at the same
relative path, then change the Saya-specific bits listed. Run `grep -rniE "saya|\.npa|\b82\b|5317|5340" .` to
find leftovers.

| File | Purpose | Change |
|---|---|---|
| `.gitignore`, `.gitattributes` | keep game content out of git | swap `*.npa/*.nss` for `*.arc`, `*._bp`, `*.bw`, movie/font extensions; keep `re/ ref/ game-data/ public/game/ dist/` |
| `scripts/check-firewall.mjs` | fails on game paths/extensions/large blobs/story text | `FORBIDDEN_EXT`, `FORBIDDEN_DIR`; `loadStoryText()` must read decompiled scenario strings instead of `<PRE>` blocks; keep the planted-fixture self-test and the coverage assertion |
| `scripts/lib/automation.mjs` | repo root, local CLI resolution, cached packages, `writeProof` | `SAYA_*` env names → `SUBA_*` |
| `scripts/verify.mjs` | tests + parse-all (asserted count) + tsc → `re/verification/verify.json` | replace the 82-script check with the decompile-all count |
| `scripts/run-browser-check.mjs` | Playwright runner, stamped proofs `{head, dirty}` | env names, default origin/port |
| `scripts/check-proofs.mjs` | proof freshness (commit + mtime) | checklist path only |
| `scripts/progress-report.mjs`, `docs/progress-checklist.json` | weighted, proof-scored progress % | rewrite the checklist items for the new game; add performance-budget items; tag each item with a fidelity `tier` (01-LESSONS §7) and add per-tier subtotals |
| `scripts/shortcut-cards.mjs` | one card per `shortcut:` comment with related evidence | address pattern if needed |
| `scripts/native-query.mjs` | cached REA/Ghidra decompiles keyed by exe digest | target exe path + expected SHA-256 |
| `scripts/native.ps1`, `scripts/compare-shots.py` | background native capture (PrintWindow, brief focus) + screenshot compare | exe/window names; low priority under the compatibility goal |
| `scripts/masked-view.py` | view scripts with prose masked | rewrite the masking for decompiled BGI scenario text |
| `scripts/freeze-stack.mjs` | CDP pause + engine-state dump for hangs | `window.game` field names |
| `tools/x86dis.py` | fast capstone disassembly queries | none (generic PE x86) |
| `scripts/split-archives.mjs` | split into blocks + `parts.json` with a content version | larger blocks or per-scene bundles (Pages 20k-file cap) |
| `scripts/deploy.mjs`, `check-deploy.mjs`, `check-shell-assets.mjs` | build → deploy → smoke/byte checks | Pages project name, domain, cache name, archive names |
| `functions/_middleware.ts`, `public/_routes.json` | Pages cache headers | archive extension |
| `scripts/pwa.ts`, `public/manifest.webmanifest`, `scripts/make-pwa-icons.mjs`, `scripts/extract-game-icon.ps1` | PWA shell, SW, icons from the exe icon | names, cache prefixes, exe path |
| `src/mobile/*` | touch input, held skip, safe-area layout, first-run tips | shortcut keys the game registers; 4:3 still fits 1280×960; storage key prefix |
| `src/archive/sha256.ts` | portable SHA-256 for non-secure contexts | none |
| `tsconfig.json`, `vite.config.ts` | strict TS, Vite (ignores `**/re/**` in watch) | dev port |
| `docs/recipes/` | optional workflow recipes from addyosmani/agent-skills (MIT): debugging, TDD, doubt-driven review. Not auto-enabled; copy only into projects that need them | none; apply the overrides in its README |
