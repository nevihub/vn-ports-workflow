# Engines seen so far, and what transfers

One section per engine. Facts here are pointers with their source; the details live in each game's docs (search
them with `npm run kb -- "<words>"` from `VN-Ports\board`). When a new port starts, add a section for its engine with
the same headings and fill it as research lands. Never quote game text here.

## At a glance
| | Saya no Uta | Subahibi | Sakura no Uta |
|---|---|---|---|
| Engine | NitroPlus N2System family (`saya.exe` v2.00) | BGI / Ethornell (`BGI.exe`) | Artemis (Re:Graphic) |
| Scripts | `.nss` source text | compiled scenarios + `._bp` system programs (bytecode) | system Lua (`init.lua`, `adv/*.lua`) + `.asb` scripts, `.iet` entry (`system/first.iet`) |
| Archives | NPA v1 | ARC20 / PackFile; DSC, BSE, CBG, BW inside | `.pfs` (pf6, pf8; split `.pfs.000/.001/...`) |
| Open runtime used | none - our own TypeScript VM; libnpengine (LGPL-3.0) as behaviour reference only | OpenBGI (GPL-2.0) compiled to WASM (route A) | artemis-compat (C++17, GPL-3.0) compiled to WASM, patched on a local branch |
| Rendering | own WebGL2 renderer, 800x600 | WebGL presentation of the engine's frames | no-GL CPU compositor host in WASM (images, text, E-mote meshes); live presentation is ticket E12/E13 |
| State (2026-10-18) | live, faithful 1:1, ~97% | live, playable, compatibility-first | in progress, not playable yet (~39%) |
| Where the details are | Game A's `AGENTS.md` (architecture table), `docs/ENGINE_SPEC.md`, `docs/RENDER_SPEC.md`, `docs/SAVE_SPEC.md` | Game B's `CLAUDE.md`, `docs/DECISIONS.md` (grep it), plan docs | Game C's `CLAUDE.md`, `HANDOFF.md`, audit notes, `outputs/*.md`, engine reports (all in ignored folders) |

## What transfers between them
- **Running the original logic beats reimplementing it.** Saya needed a hand-written VM (no usable open runtime);
  Subahibi and Sakura compile an existing open runtime to WASM. Check for an open reimplementation first
  (`LESSONS.md` §7: write an opcode spec only when none exists).
- **Archive serving:** Cloudflare Pages ignores HTTP Range and caps files at 25 MiB, so every port splits archives
  into blocks + `parts.json` with a content version (`LESSONS.md` §4 Hosting). Sakura reads blocks through a bounded
  cache over synchronous XHR from the WASM host, which blocks prefetch (Sakura E10) - an async host (worker,
  Asyncify/JSPI) is the known upgrade path (Sakura E13 measures it).
- **Saves:** with an existing engine, use its own save path and persist its files verbatim (Subahibi/OpenBGI);
  only a hand-written VM needs its own serializable frame stacks (Saya).
- **Audio on iOS:** transcode Ogg to AAC at build time; decode only while audible; missing files end silently
  (Saya found 4 voice files referenced but absent from the shipped archives).
- **Mobile shell** (touch bar, long-press = right click, held skip, safe areas, PWA without a service worker cache
  of the game) is engine-independent: `knowledge/templates/src/mobile/*`, `scripts/pwa.ts`.
- **Content firewall** for each game: derive the forbidden text set from that game's own script strings (8-token
  shingles) and self-test on a planted fixture before the first commit (Saya `check-firewall.mjs`, Subahibi
  `scripts/check-firewall.mjs`). Sakura relies on ignored V: folders and has no shingle firewall yet.
- **Headless first:** every port got to "boots headless with a census of unknown opcodes/built-ins" before any
  browser work; Sakura's runs are headless only (never open a game window on the user's PC).
- **GPL runtimes:** publishing a WASM build derived from a GPL runtime means publishing its source (approved for
  Subahibi's OpenBGI route; ask before the first public Sakura build).

## Template for a new engine
```
## <Engine name> (<game>)
Scripts / archives / images / audio / video formats - with the tool that verified each (and its denominator).
Open runtimes or tools found, licence, how far they get (boots? title? first scene?).
Entry points that worked for RE (string tables, dispatchers, init defaults).
Pitfalls (each with the evidence that showed it).
What transfers from the engines above, what does not.
```
