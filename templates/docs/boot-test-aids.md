# Boot and test aids — shared spec (W8)

One list of the test shortcuts every port's headless proofs should offer, borrowed
from the DD64 PC port's dev aids (`DD64_BOOT`, `DD64_TAP`, `DD64_PRESS`,
`DD64_SHOT`, `DD64_PROFILE`, `DD64_GFXLOG`, `DD64_WAVOUT`, `DD64_WATCH`). Each
game keeps its own map (for example `docs/BOOT-AIDS.md`) with a fast checker;
this file says what each aid means and the rules every map follows.

## The aids

| Aid | What it does | What a port provides |
|---|---|---|
| stop-after | End the run after N seconds or frames | a `--seconds`-style harness flag |
| tap | Scripted clicks at a position and time | repeatable `--click X,Y@S`-style flags |
| press | Drive menus until the story starts | a `--start`-style flag with a start-after delay |
| shot | Pictures of the run | per-screen shots plus a final shot; coarse fingerprints only, never text |
| profile | A performance trace for the run | a `--profile`-style flag writing a trace file |
| gfx-log | Render counts per second | presents/draws counters in the proof JSON |
| dump | Decoder and asset stats | image/decode hit, error and header counts |
| wav-out | Sound state for the run | scheduled-buffer, gap and context-state counters (no audio files) |
| watch | What went wrong | page errors, console lines and failed requests in the proof |
| run copies | Tests never touch the user's files | proofs only under ignored `re/`; env vars isolate parallel runs and ports |

## Gaps stay gaps

A port lists aids it does not have (for example direct-to-scene boot or a
wrong-width access log) as gaps with the reason, never as mappings. The game's
checker fails on any name it does not know and on any resolving row whose flag
or reader is gone.

## Rules every map follows

- Headless only; never let the game take the screen or focus.
- One preview port per run; never share a production preview between agents.
- No story text in the doc or in any proof: file names, counts and timings only.
- The content firewall runs before every commit; `re/` stays ignored.
