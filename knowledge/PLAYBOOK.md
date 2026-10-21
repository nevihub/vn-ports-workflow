# Port playbook: from "which game?" to "live on a phone"

For the reverse-engineering work inside S0-S2 (the binary, its archives, decoders, the engine route) read
`RE-PORT-PLAYBOOK.md` too; it keeps these stage IDs.

The standard stages every VN port goes through. A new game's `docs/BACKLOG.md` timeline starts from these (the
`npm run new-port` scaffold writes them), and an agent told "continue <game>" works the stage the board marks
"you are here". Each stage ends at a printed exit gate - a command whose output proves it, never a feeling.
Details and the failures behind each rule: `LESSONS.md`; Saya's ladder of gates: `Saya no Uta\docs\WORKFLOW.md`;
Subahibi's phase plan: `subahibi-port-kit\docs\03-SUBAHIBI-PLAN.md`.

| Stage | Work | Exit gate |
|---|---|---|
| **S0 Research** | Identify the edition and engine (PE version, file magics, archive census with sizes). Look for open runtimes, extractors and prior ports; check `ENGINES.md` for a known engine. Write findings with PROVEN / STRONG / LEAD labels. Treat outside research reports as leads (Sakura's `AUDIT-DELTA.md` found several overstated claims). | a fingerprint JSON in an ignored folder with zero unknown magics (or an explicit list); a research note naming the route |
| **S1 Safe repo + extraction** | Content firewall **before the first commit**; masked viewer (never print story text); archive reader with a counted listing; decode/decompile-all with the count asserted. Copy reusable pieces from `knowledge/templates/` (`TEMPLATES.md`). | `firewall` passes on a planted fixture; entries == header count; N/N scripts parse |
| **S2 Boots headless** | Run the engine (open runtime or own VM) natively/headless to the title with an unknown-opcode / built-in census. Decide the route by measurement (existing runtime -> WASM, or own VM from an opcode spec). | title reached headless; census has 0 unknowns on the boot path; route recorded in `docs/DECISIONS.md` |
| **S3 Pictures and words right** | Rendering, text, transitions, effects in the browser host; compare against the user's reference screenshots, never against guesses. | stamped browser proofs per surface; reference checkpoints agree |
| **S4 Playable in a browser** (`Playable: yes`) | Live input, audio, saves, menus, choices, movies; first launch to every ending. Announce this milestone on its own. | per-route or per-scene runs reach every ending; save -> reload -> load continues the same route |
| **S5 Phones and compatibility** | Mobile shell (touch bar, long press, held skip, safe areas, PWA), iOS audio/video unlock, Safari/WebKit quirks, low-memory tier. | the user's iPhone report (a `U` ticket); automated WebKit/mobile-viewport proofs |
| **S6 Faster and smaller** | Asset transcode (WebP/AAC), per-scene streaming and prefetch, memory caps, fps cap, `?perf=1` readout. | budgets met on 4x CPU throttle and on the phone; no memory growth across scenes |
| **S7 Live** | Split blocks for Cloudflare Pages, deploy script with smoke + shell byte checks. **Agents prepare; the user deploys** (or says "deploy" in chat). | the user's go; live smoke check passes |

## Every stage, every session
1. `npm run issue -- goal` to see the stage; `npm run issue -- next --agent <you>` to pick; `claim` before working.
2. Smallest correct change, a test for any non-trivial logic, the game's checks, then a local commit.
3. `done`, `audit`, `learn` (one line if another port could use it), handoff top block.

## Proof freshness at stage gates
A proof goes stale the moment its evidence stops matching the tree — which is exactly when a
stage exit would lie. Any S-gate ticket scored from stamped proofs (S2 census, S3 surface proofs,
S4 route runs, S5/S6 device and budget proofs) wires freshness into its gate:

- `Proof: npm run check-proofs -- --strict` (template script; fails on any passing-but-stale proof).
- `fresh` — proof commit is HEAD's ancestor with no source change since, and no source file is
  newer than the proof. `fresh-worktree` — same, but the tree was dirty when captured (mtime-dated).
- `stale` — a source file changed after the proof (mtime path) or a source commit landed after the
  proof's commit (commit path). Re-run the harness, never hand-edit the proof.
- `untraceable` — the proof records no commit (old harness); re-capture it with a stamping harness.
- `missing` — the checklist names a proof no file matches; the harness never ran.

## Reuse between ports
Before building anything, `npm run kb -- "<what you need>"`: Saya and Subahibi solved hosting, saves, iOS audio,
touch input and proof tooling already. Lift a piece into `knowledge/templates/` when a second port copies it.
