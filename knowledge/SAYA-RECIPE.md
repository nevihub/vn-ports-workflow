# How the Saya port was built (reusable patterns)

Source repo (example from the original project): `<vn-ports>/Saya no Uta`. Read the files named here for the details; don't copy
engine code that is Saya-specific (NSS parser/VM).

## Layout
| Path (Saya repo) | Role | Reuse for Subahibi |
|---|---|---|
| `src/archive/npa.ts` | archive reader over HTTP Range **or** split blocks (`parts.json`), LRU of 4 blocks/archive, shared in-flight requests, Cache Storage preload after title | pattern: replace NPA parsing with ARC20 + DSC/BSE |
| `src/nss/parser.ts`, `vm.ts` | script → bytecode, VM with serializable frames + threads | pattern only (route B) |
| `src/engine/game.ts` | boot, frame loop, input → engine events, drawing | pattern |
| `src/engine/objects.ts` | object tree, priorities, tweens | pattern (route B) |
| `src/engine/text.ts` | text layout/typing/paging/backlog | pattern; fonts need less precision now |
| `src/engine/saves.ts` | IndexedDB records, retry → session-only fallback, export/import `.sayasave` | **reuse logic** |
| `src/render/gl.ts` | WebGL2, fixed back-buffer, mask transitions in shaders | **reuse approach** (1280×960) |
| `src/audio/audio.ts` | Web Audio buses (BGM/SE/VOICE), fades, sample-accurate loops, decode-only-while-audible, missing-file tolerance | **reuse logic** |
| `src/mobile/*` | touch → click/long-press, touch bar, held skip, safe-area letterbox, first-run tips | **copy** (`knowledge/templates/`) |
| `scripts/pwa.ts` | Vite plugin: manifest, icons, service worker (network-first navigation, shell-only cache) | **copy** |
| `functions/_middleware.ts` | Pages cache headers | **copy** |
| `scripts/split-archives.mjs`, `tools/compress_npa.py`, `tools/check_compression.py` | split into blocks + content version; lossy repack + audit | adapt to per-scene bundles |

## Build/deploy pipeline (worked first try once set up)
`npm run build:compressed` = tsc + vite → repack assets (WebP/AAC) → audit (names/bounds/byte-identical UI,
sampled decodes) → split → `dist/`. `npm run deploy` = that + `wrangler pages deploy` to project `saya`, then
`check:deploy` (anonymous HTTP smoke + browser title/reload) and `check:shell` (live JS/CSS/SW bytes == dist).

## Things that took the most time (plan for them early)
1. Text layout/paging/fonts (GDI metrics vs canvas): ~30% of the effort. With the compatibility goal, aim for
   "fits the box and pages correctly", not glyph parity.
2. Input edge cases (press/release pairing, select loops, touch compat events, menu locks).
3. Menu/save/load semantics (reserved slots, object banks, resume into suspended gameplay).
4. Mobile memory and audio on iOS (AAC, resume rejection, decoded-cache growth).
5. Proof freshness: the process tooling in `docs/WORKFLOW.md` paid for itself.

## Verification tooling worth copying
`verify.mjs` (tests + parse-all count + tsc → JSON proof), `run-browser-check.mjs` (Playwright via installed
Chrome, stamped proof), `check-proofs.mjs`, `progress-report.mjs` + `docs/progress-checklist.json` (weighted,
proof-scored), `check-firewall.mjs`, `shortcut-cards.mjs`, `freeze-stack.mjs` (CDP pause + engine-state probe
for hangs). For performance budgets add a harness that samples `performance.memory`/heap snapshots,
long tasks (`PerformanceObserver('longtask')`), frame times and transferred bytes per scene.
