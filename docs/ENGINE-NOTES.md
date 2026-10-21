# Engine notes (3 examples — add yours with the same headings)

Facts here are pointers; details live in each game's docs. When a new port starts, add a section with the same
headings and fill it as research lands. Never quote game text here.

## At a glance

| | Game A (N2System family) | Game B (BGI / Ethornell) | Game C (Artemis) |
|---|---|---|---|
| Scripts | `.nss` source text | Compiled scenarios + `._bp` system programs (bytecode) | System Lua + `.asb` scripts, `.iet` entry |
| Archives | NPA v1 | ARC20 / PackFile; DSC, BSE inside | `.pfs` (pf6, pf8; split `.pfs.000/.001/...`) |
| Images / audio / video | Per-game formats — name the tool that verified each (with its denominator) | CBG / BW pictures; Vorbis voices; movie files | Per-game formats — same rule |
| Open runtime used | None — own TypeScript VM; a reference engine (LGPL) as behaviour reference only | Open engine (GPL-2.0) compiled to WASM (route A) | Compat engine (C++17, GPL-3.0) compiled to WASM, patched on a local branch |
| Rendering | Own WebGL2 renderer (800×600) | WebGL presentation of the engine's frames | CPU compositor host in WASM (images, text, meshes) |

## What transfers between them

- **Running the original logic beats reimplementing it.** Only hand-write a VM when no usable open runtime exists. Check for an open reimplementation first; write an opcode spec only when none exists.
- **Archive serving:** some static hosts ignore HTTP Range and cap files (25 MiB/file, 20k files on Pages) → split archives into blocks + `parts.json` with a content version. Bigger blocks or object storage at multi-GB scale.
- **Saves:** with an existing engine, persist its own files verbatim; only a hand-written VM needs its own serializable frame stacks.
- **Audio on iOS:** transcode Ogg to AAC at build time; decode only while audible; missing files must end silently.
- **Mobile shell** (touch bar, long-press, held skip, safe-area letterbox, PWA without a game-data cache) is engine-independent: `templates/src/mobile/*`, `templates/scripts/pwa.ts`.
- **Content firewall** per game: derive the forbidden text set from that game's own script strings and self-test on a planted fixture before the first commit.
- **Headless first:** every port gets to "boots headless with a census of unknown opcodes/built-ins" before any browser work; never open a game window on the user's screen.
- **GPL runtimes:** publishing a WASM build derived from a GPL runtime means publishing its source (ask before the first public build).

## Template for a new engine

```
## <Engine name> (<game>)
Scripts / archives / images / audio / video formats — with the tool that verified each (and its denominator).
Open runtimes or tools found, licence, how far they get (boots? title? first scene?).
Entry points that worked for RE (string tables, dispatchers, init defaults).
Pitfalls (each with the evidence that showed it).
What transfers from the engines above, what does not.
```
