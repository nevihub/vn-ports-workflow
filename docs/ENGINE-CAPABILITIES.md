# Engine capabilities: the 8-function surface every port implements

Each game hand-rolls detection/extraction/decode/save/prove harnesses that drift apart. This file
fixes the seam: whatever the route (WASM, own VM, converted IR), the port exposes these eight
functions with these shapes. Harnesses, proofs and saves are written against the surface, not the
engine, so a piece lifted from one port runs on another. Terms: `PROVEN` (two paths agree),
`STRONG` (one path + census), `LEAD` (unverified — becomes an RE ticket).

| # | Function | In | Out | Rule |
|---|---|---|---|---|
| 1 | `detect(bytes)` | first bytes / magic | `{ format, confidence }` | Unknown magic is an explicit list, never a guess |
| 2 | `extract(archive)` | archive bytes | entries `[{ name, size }]` | `entries.length` equals the header count |
| 3 | `decode(entry)` | entry bytes | ops `[{ op, arg }]` | N/N entries decode; failures name the offset |
| 4 | `controlFlow(ops)` | ops | `{ labels, jumps }` | every jump target exists (0 dangling) |
| 5 | `execute(ops, input)` | ops + choice indices | events `[{ say } \| { choice } \| { end }]` | deterministic: same input, same events |
| 6 | `assets(manifest)` | wanted names | `{ found, missing }` | missing ends silently + logs; never retry-loops |
| 7 | `save(frame)` / `load(blob)` | `{ pc, vars }` | opaque JSON string | save → reload → load continues the same route |
| 8 | `verify(events)` | events | hex digest | the progress report scores only from stamped digests |

The reference below is synthetic (a 5-op toy ISA, no game content) and lives under test at
`board/tests/engine-capabilities.test.mjs`: it proves the surface composes — detect → extract →
decode → control-flow → execute → save/load mid-route → verify — before any real engine is wired.
