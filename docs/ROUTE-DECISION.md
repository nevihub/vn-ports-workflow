# Route decision: WASM, own VM, or offline IR conversion

`docs/PORTING-GUIDE.md` picks between two build routes. This file adds the third and says how
to choose by measurement instead of taste. Routes A and B are unchanged; route C suits a game
whose engine is too costly to reimplement but whose scripts are data that can be converted once,
offline, and played by a small IR runner in the browser.

## Comparison

| | A: open engine to WASM | B: own VM in TypeScript | C: offline IR conversion |
|---|---|---|---|
| When | An open reimplementation covers your build | No usable runtime, or it misses too much | Scripts are structured data; the engine is big but its semantics are few |
| Work | Compile + bind + persist its saves | Opcode spec first, then VM + host | A converter (run once per script version) + a small IR player |
| Licence | Read it first: GPL in WASM means publishing the build's source (approved per game) | Your code, your licence; cite addresses/specs per opcode | Converter reads the original; the shipped IR is derived data — record the derivation |
| Falls apart when | Version gaps in engine coverage | Undocumented opcodes pile up (each becomes an RE ticket) | Semantic gaps (timing, effects) hide in the original engine |
| Proof it fits | Title headless + 0 unknowns on the boot path | Same gate: headless VM to title + 0 unknowns | IR player reaches the title; event log matches the reference run byte-for-byte |

## Decision procedure (in order, stop at the first that passes)

1. **Coverage check.** Does an open runtime run this exact build to the title? If yes → A.
   Evidence: headless run + unknown census, recorded in `docs/DECISIONS.md`.
2. **Data check.** Parse every script offline and count: structured ops vs opaque blobs. If the
   scripts decompile to a small op set (tens, not hundreds) with explicit control flow → C is
   viable. If they embed native code, encryption you cannot replay, or engine callbacks per line → B.
3. **Cost check.** Estimate the converter (C) vs the VM (B) in opcodes, not feelings: list the
   distinct ops, mark each PROVEN / STRONG / LEAD with the test that would upgrade it. The
   shorter honest list wins. Ties go to B (fewer moving parts at runtime).
4. **Record.** Route + evidence + rejected alternatives in `docs/DECISIONS.md` (S2 exit gate).
   A wrong pick is cheap to reverse before S3; after S3 it is a replan, not a tweak.

Route C's converter is build tooling: it runs on your machine over your legally owned copy,
its outputs are derived data in ignored folders, and the firewall still gates every commit.
