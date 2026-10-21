# VN Ports Workflow (private)

How we port visual novels to the browser — the shared method behind three ports (N2System, BGI, Artemis engines).

No game files live here. No scripts, art, voices, movies, exes, fonts, or story text. Only the workflow: stages, rules, ticket board, and file templates. You bring your own legally owned game.

## How a port flows

```mermaid
flowchart LR
    S0["S0 Research\nfingerprint + formats"] --> S1["S1 Safe repo\nfirewall + counted extract"]
    S1 --> S2["S2 Boots headless\n0 unknown opcodes"]
    S2 --> S3["S3 Pictures + words\nstamped proofs"]
    S3 --> S4["S4 Playable\n★ every ending"]
    S4 --> S5["S5 Phones\ntouch + iOS audio"]
    S5 --> S6["S6 Faster + smaller\nbudgets met"]
    S6 --> S7["S7 Live\nyou deploy"]
```

Playable (S4) is its own announced milestone — phones and polish come after, never before.

## Start here (10 minutes)

1. Read `AGENTS.md` (the work loop) and `knowledge/PLAYBOOK.md` (stages S0–S7).
2. Read `docs/PORTING-GUIDE.md` — pick your route: own VM (no open engine) or compile an open engine to WASM.
3. Scaffold a game repo: `npm run new-port -- <id> "<Full name>" "<engine>"`.
4. Work the tickets: `npm run issue -- goal`, `next`, `claim`, `done` (see `docs/CHECKLIST.md`).

## Which route? (pick once, in S0–S2)

```mermaid
flowchart TD
    Q{"Open engine exists\nfor this build?"} -- "yes, covers it" --> A["Route A: compile to WASM\npersist its own saves"]
    Q -- "no" --> B["Route B: own VM in TS\nwrite the opcode spec first"]
    A --> G["Same gate: title headless,\n0 unknowns on the boot path"]
    B --> G
```

Details: `docs/PORTING-GUIDE.md`. Licence check first — a GPL runtime compiled to WASM means publishing its source.

## What's inside

| Folder | What |
|---|---|
| `knowledge/` | Stages, evidence rules (`PROVEN / STRONG / LEAD`), firewall + proof patterns, engine notes, lessons |
| `board/` | Ticket CLI (`issue.mjs`), live board (`board.mjs`), search (`kb.mjs`), new-game scaffold (`new-port.mjs`) |
| `templates/` | Fresh-repo skeleton: firewall, proofs, PWA shell, mobile input, archive splitting, build/deploy |
| `docs/` | `PORTING-GUIDE.md` (route A vs B), `CHECKLIST.md` (per-ticket loop), `ENGINE-NOTES.md` (3 engines side by side) |
| `examples/` | Small sample ledger + decision entries so the format is clear |
| `scripts/` | `check-repo-clean.mjs` — proves no game content leaked |

```
vn-ports-workflow/
├── AGENTS.md            work loop + hard rules (agents read this first)
├── knowledge/           stages, evidence rules, lessons, engine notes
├── board/               tickets, live board, search, new-game scaffold
├── templates/           fresh-repo skeleton (copied per game)
├── docs/                porting guide, per-ticket checklist, engine notes
├── examples/            sample ledger + decision entries
└── scripts/             repo-clean checker (the gate)
```

## Rules that matter most

- Content firewall before the first commit. Game files live only in ignored folders.
- Never print story text — not in code, docs, tests, or commits. Use the masked viewer.
- Evidence over guesses. Two paths agree, or it stays a `LEAD`.
- Each ticket has a `Proof:` command. `done` runs it and refuses to close on failure.
- Commit locally only. You deploy, with `npm run deploy`, after a green smoke check.

See `knowledge/DEFAULTS.md` for the standing choices (playable first, phones second, polish last).
