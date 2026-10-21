# Porting guide: from "which game?" to "live in a browser"

Companion to `knowledge/PLAYBOOK.md` (stages S0–S7) and `knowledge/RE-PORT-PLAYBOOK.md` (RE method).
This file helps you pick a route. Engine facts: `docs/ENGINE-NOTES.md`.

## The two routes

| | Route A: open engine to WASM | Route B: own VM in TypeScript |
|---|---|---|
| When | An open reimplementation of the engine exists and covers your build | No usable open runtime, or it misses too much |
| Examples | BGI/Ethornell via OpenBGI (GPL-2.0); Artemis via artemis-compat (GPL-3.0) | N2System NSS: hand-written lexer/parser/VM |
| Licence check | Read the licence first. A GPL runtime compiled to WASM means publishing its source (approved per-game before the first public build). A behaviour reference (e.g. LGPL) is read-only — never copy its code. | Your code, your licence. Still cite the addresses/specs behind each opcode. |
| Cost | Cheap if the engine covers the build; falls apart on version gaps | Slow up front (opcode spec first), exact later |
| Proof you picked right | Title reached headless + opcode/built-in census shows 0 unknowns on the boot path | Same gate: headless VM to title + 0 unknowns |

Rule of thumb: check for an open runtime before writing a VM (`RE-PORT-PLAYBOOK.md` §5). If none exists, write a small machine-readable opcode spec first (operands, stack effect, side effects, evidence addresses, confidence) and implement from it — missing semantics become RE tickets, not guessed code.

A third option — offline IR conversion (convert scripts once, ship a small player) — is compared
against these two in `docs/ROUTE-DECISION.md`, with the measurement order that picks between all three.

## Stage by stage (short)

- **S0 Research.** Fingerprint the install (hashes, archive magics, sizes) into an ignored JSON. Name each format (PROVEN / STRONG / LEAD + the test that would upgrade it). Note prior art and licences in `docs/DECISIONS.md`. Exit: zero unknown magics, or an explicit list.
- **S1 Safe repo + extraction.** Firewall before the first commit (planted-fixture self-test). Archive reader with counted listing (entries == header count). Decode/decompile-all with the count asserted. Masked script viewer only. Exit: `firewall` passes, counts match, N/N scripts parse.
- **S2 Boots headless.** Run the logic with no window to the title. Census of unknown opcodes/built-ins on the boot path. Route recorded in `docs/DECISIONS.md`. Exit: title reached, 0 unknowns.
- **S3 Pictures and words right.** Rendering, text, transitions, effects in the browser host. Compare against reference screenshots from the original (never against guesses). Exit: stamped browser proofs per surface.
- **S4 Playable.** Input, audio, saves, menus, choices, movies; every ending reached in route runs; save → reload → load continues the same route. Announce this milestone on its own. Exit: per-route runs reach every ending.
- **S5 Phones.** Touch bar, long-press (= right-click), held skip, safe areas, PWA, iOS audio/video unlock, WebKit quirks. A device report is a user (`U`) ticket. Exit: user report + automated mobile proofs.
- **S6 Faster and smaller.** Asset transcode (WebP/AAC), per-scene streaming, memory caps, fps cap, `?perf=1` readout. Exit: budgets met at 4x CPU throttle and on the phone; no memory growth across scenes.
- **S7 Live.** Split blocks for static hosting (no HTTP Range on some hosts; 25 MiB/file and 20k-file caps on Pages — use bigger blocks or R2 at scale). Dry-run the deploy, then the user deploys. Exit: live smoke + byte checks pass.

## Hosting, saves, audio, mobile (copy these, don't reinvent)

- **Archives:** split into blocks + `parts.json` `{partSize, sizes, version}` (version = content hash, used as `?v=`). LRU a few blocks; preload after the title; background-fill Cache Storage. See `knowledge/SAYA-RECIPE.md` and `templates/scripts/split-archives.mjs`.
- **Saves:** with an existing engine, persist its own files verbatim. With your own VM, serializable frame stacks (not JS async). Reserved slots and menu object banks are separate — read the original menu scripts before designing storage. Export/import file for device transfer.
- **Audio:** transcode Ogg to AAC at build time (decode by content, keep names). Decode BGM only while audible. Missing assets end silently + log — never retry-loop a load into a freeze. `AudioContext.resume()` can reject on iOS; retry on later gestures.
- **Mobile:** tap = click on release; stationary ~550 ms long-press = right-click; touch bar dispatches the game's own shortcut keys; held Skip = held Ctrl. Service worker: network-first navigation, shell-only cache — never silently precache the game. iOS caches Home Screen icons at add time (re-add to see a new icon).
- **Proofs:** one browser harness per surface, each writing a stamped JSON proof (`{head, dirty}`) into an ignored folder; the progress checklist scores only from proofs. Report targets as gates, not facts. Rerun red perf gates alone on a quiet machine before treating the fix as bad.

## What to read when

| If you are doing | Read |
|---|---|
| Fingerprint + formats + decoders | `knowledge/RE-PORT-PLAYBOOK.md` §§0–3, `TEMPLATES.md` firewall row |
| Choosing VM vs WASM | `knowledge/ENGINES.md`, `docs/ENGINE-NOTES.md` |
| Setting up the repo | `knowledge/TEMPLATES.md`, `templates/` |
| Running agents day to day | `AGENTS.md`, `docs/CHECKLIST.md`, `knowledge/DEFAULTS.md` |
| Stuck on a hard problem | `knowledge/LESSONS.md` §§1,4,5 + lesson log, then `npm run kb` |
