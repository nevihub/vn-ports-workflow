# Portable RE + browser-port playbook (v1)

Written 2026-10-18 (ticket E12, Subahibi) from the Subahibi port: an original BGI/Ethornell engine game that runs in a
browser through a reference engine compiled to WASM (route A). It is for any agent porting a game from an original
binary and its archives. Its acceptance test is U4: a fresh agent, this file only, and a different game the user owns,
through stages R1-R3 below.

**Read this first.** The stage names and exit gates live in `PLAYBOOK.md` (S0-S7); this file says what the
reverse-engineering work is inside each stage. Every rule carries one tag: **[P]** portable to any engine,
**[B]** the BGI/Ethornell module (any BGI or Ethornell game), **[S]** Subahibi-only (section 6: check before copying).

## 0. First hour on a new game

| # | Do | Printed gate | Stage |
|---|---|---|---|
| 1 | `npm run kb -- "<engine or game words>"` in VN-Ports; read the engine row in `ENGINES.md` | prior art named, or "none found" | S0 |
| 2 | Create the game repo and install the content firewall before the first commit **[P]** | firewall passes on a planted fixture | S1 |
| 3 | **R1 fingerprint** **[P]**: hashes and a magic census of the install, read-only | JSON in an ignored folder; zero unknown magics, or an explicit list | S0 |
| 4 | **R2 format identification** **[P]**: name each magic and cite the reference that defines it | each archive type PROVEN or STRONG; a LEAD names the test that would upgrade it | S0 |
| 5 | **R3 decoder verification** **[P]**: decode a sample with two independent decoders and compare hashes; take entry counts from the archive headers | entries == header count; sample hashes agree, or the difference is listed | S1 |
| 6 | Read any script only through the masked viewer; never print dialogue or story text **[P]** | viewer self-test passes | S1 |

Steps 3-5 are the first three playbook stages that the U4 test checks.

## 1. Stages (PLAYBOOK.md IDs)

| Stage | Reverse-engineering work inside it | Gate (PLAYBOOK.md is the authority) | Tools (section 3) |
|---|---|---|---|
| S0 Research | R1 fingerprint, R2 format identification, a research note with PROVEN / STRONG / LEAD labels, the engine-route question for S2 | PLAYBOOK S0: fingerprint JSON with zero unknown magics or an explicit list; R2 labels printed | T2, T9, T19 |
| S1 Safe repo + extraction | firewall, masked viewer, archive reader with a counted listing, R3 decoder verification, decompile-all with the count asserted | PLAYBOOK S1: firewall on a planted fixture; entries == header count; scripts parse N/N | T1, T3, T4, T5, T8 |
| S2 Boots headless | run the original logic headless to the title; census of unknown opcodes on the boot path; choose the route by measurement | PLAYBOOK S2: title reached headless; census has 0 unknowns on the boot path; route recorded | T7, T9, T10, T12 |
| S3 Pictures and words right | rendering, text, transitions and effects in the browser host, checked against the user's reference screenshots | PLAYBOOK S3: stamped browser proofs per surface; reference checkpoints agree | T11, T13 |
| S4 Playable in a browser | live input, audio, saves, menus, choices and movies; every ending reached in route runs; save, reload and load continue the same route | PLAYBOOK S4: per-route runs reach every ending; save, reload, load continues the route | T12, T13, T14 |
| S5 Phones and compatibility | touch, held skip, audio unlock, WebKit quirks; a device report is a user (U) ticket | PLAYBOOK S5: the user's device report (U ticket) and automated mobile proofs | T13 |
| S6 Faster and smaller | budgets measured at CPU x4 and on a phone; per-scene streaming; memory caps; no growth across scenes | PLAYBOOK S6: budgets met at CPU x4 and on the phone; no memory growth across scenes | T15, T16 |
| S7 Live | asset audit; the agent prepares the deploy, the user runs it | PLAYBOOK S7: the user's go; live smoke check passes | T17, T18 |

## 2. Evidence rules **[P]**

- **PROVEN**: two independent paths agree (for example the disassembly and a decompiler on the same binary, or the
  bytecode and a runtime observation), or a direct test shows it.
- **STRONG**: one clear path; no second path yet.
- **LEAD**: plausible and unconfirmed. A reference engine alone never proves the target build's behaviour; it stays
  a LEAD until checked against the owned binary.
- Anything a fix depends on needs a second path before it ships.
- Work the cheapest evidence first: (1) cached notes (grep the topic notes, the decisions and the handoff),
  (2) reference engines (behaviour only; check the licence), (3) data and bytecode, (4) fast disassembly,
  (5) an independent decompiler.
- Record every finding in a topic note: the question, the addresses or offsets, what each path showed, the label,
  and the change it implies.
- Timebox: after about an hour without an answer, write `// shortcut: <limit>, <when to upgrade>` with the best guess,
  list it in the handoff, and move on.
- Running the native game on screen (focused or not) is allowed for reference capture; use a hash-checked copy,
  never the install (user, 2026-10-30; see root `AGENTS.md`).

## 3. Tools inventory

"Runs in" names where a command runs: the game folder, `board\` (the shared ledger CLI) or the VN-Ports root. Each row
names real commands; the checker `npm run proof:playbook` in Subahibi resolves every name against a package.json or a
file under `scripts/` or `tools/`.

| ID | Command | Runs in | Stage | Produces or proves | Tag |
|---|---|---|---|---|---|
| T1 | `npm run firewall` | game folder | S1 | content firewall: refuses files that repeat story text from an ignored strings folder; reports UNAVAILABLE until that folder exists | P (rule), S (check) |
| T2 | `npm run fingerprint` | game folder | S0 | hashes, archive index and content-type census in an ignored JSON file | P |
| T3 | `npm run decode-check` | game folder | S1 | decoders over the whole install, checked against the reference decoders | B |
| T4 | `npm run oracle:compare` | game folder | S1 | decoder output compared with the reference oracles | B |
| T5 | `npm run view -- FILE [START END]` | game folder | S1 | masked view of a decompiled script; the only sanctioned way to read one | P |
| T6 | `npm run health` | game folder | S1-S6 | viewer self-test, firewall, unit tests, decompile count, type check | S |
| T7 | `npm run native-query -- <addr>` | game folder | S2 | cached Ghidra decompile of the native binary: the independent second path | P (method), S (setup) |
| T8 | `wsl -d <distro> -- sh scripts/scn.sh decompile` | game folder (WSL) | S1 | every scenario and system program decompiled into the ignored `re/` folder | B |
| T9 | `uv run --with capstone --with pefile python -I tools/x86dis.py <exe> dis\|func\|xref\|find ...` | game folder | S0-S2 | fast disassembly and string search in the native binary | B |
| T10 | `wsl -d <distro> -- sh scripts/openbgi.sh` | game folder (WSL) | S2 | the pinned reference engine built for tests and for the browser route | S (route A) |
| T11 | `npm run build:web` | game folder | S3-S6 | static blocks and the engine copied into the public folder | S |
| T12 | `npm run proof:scene` | game folder | S2-S4 | boot, press START, first scene, in a headless browser, with budget metrics | S |
| T13 | `npm run proof:save` · `proof:surface` · `proof:choice` · `proof:extras` · `proof:skip` · `proof:player` · `proof:movie` | game folder | S4-S5 | one browser proof per surface: save and load, menus, choices, extra modes, skip, phone hub, movies | S |
| T14 | `bash scripts/route-run.sh LABEL [secs] [speed] [click-ms]`, then `npx vite-node scripts/route-report.ts LABEL` | game folder (WSL) | S4 | headless route run: scenes entered, assets read, unknown opcodes | S |
| T15 | `npm run proof:budget -- --cpu=4` | game folder | S6 | cold and warm launch to the title; bytes before the title (app and wire); long tasks while reading | S |
| T16 | `node scripts/boot-timeline.mjs [URL] [--click]` · `node scripts/voice-latency.mjs` · `node scripts/profile-text.mjs` | game folder | S6 | boot timeline; input-to-audio latency; CPU profile while reading | S |
| T17 | `npm run audit:assets` · `npm run audit:proofs` | game folder | S7 | every asset the scenes name is shipped and decodes; every proof matches the current build | S |
| T18 | `node scripts/deploy.mjs` (dry run: builds `dist/` and checks the Pages limits); `npm run deploy` uploads, so run it only on the user's "deploy" in chat; then `npm run check:deploy` | game folder | S7 | the dry run's limits; after an upload, a live smoke check and byte match of the shipped files | S |
| T19 | `npm run issue -- goal \| next \| claim \| progress \| done \| block \| audit \| learn \| say \| inbox` | game folder (shared CLI in `board\`) | all | the ticket ledger, claims, channel messages, lesson log | P |
| T20 | `npm run kb -- "<words>"` | VN-Ports root (or `board\`) | all | search of shared knowledge and every game's decisions and handoffs | P |
| T21 | `npm run status` · `npm run resume` · `npm run preflight` | game folder | all | one-screen status; session start; servers and tools present | S |
| T22 | `npm run board` | `board\` | all | the live board for every game | S |

## 4. Execution protocol **[P]**

- **Claims.** Claim a ticket before working, and record the model on the claim. One writer per checkout: parallel work
  gets its own worktree and branch. Never edit another agent's claimed files.
- **Gates.** A ticket's `Proof:` is an `npm run` script that fails when the gate is not met; `done` runs it and
  refuses to close on a failure. Fix the work, never the checker. A proof that reports its targets as facts and gates
  only on its checks cannot fail on those targets (LESSONS.md, 2026-10-18 "budget proof" entry): check the targets.
- **Evidence.** Counts, sizes, hashes and file names only; never story text, dialogue or quotes. Label every RE claim
  (section 2).
- **Handoffs.** Keep the handoff's top block to 60 lines or fewer and update it after every step; list long jobs there
  (what, process id, output path). Write each finding another port could use with `issue learn`.
- **Commits.** Local commits only. Run the firewall before every commit; each agent adds its own co-author line.
- **Approvals.** An agent never does these alone: a push to any remote; a deploy or publish; game content on a new site
  or domain; anything that costs money; destroying user data or any irreversible step outside the repo; changing a
  locked checker (the user re-locks it); accepting a licence or consent screen for a third-party service; a direction no
  default covers (ask once, recommended option first). User (U) tickets are never started by an agent.

## 5. BGI/Ethornell module **[B]**

Applies to BGI and Ethornell engine games. Everything here is engine structure, not game content; keep game names and
story out of notes.

- **Install layout.** The native executable is the engine. The game's logic lives in compiled scenario scripts and in
  system programs (`._bp`, decompiled to `.bps`). Much engine policy (folder names, search paths, default settings)
  sits in the system programs, so grep them before searching the executable for strings.
- **Archives and formats** (names as the reference tools use them): `.arc` archives with ARC20 or PackFile headers;
  per-entry compression DSC and BSE; pictures in CBG (CompressedBG, v2 variant) and BW; BF_Movie movie files; voices as
  Vorbis inside archives. The reference decoder set is GARbro's Ethornell module (a behaviour reference; check its
  licence) and the OpenBGI decoders.
- **Verification.** Entry counts come from the archive headers. Decoders are checked against both references across
  the whole install, not a sample alone.
- **Engine routes.** Route A is an open reimplementation (OpenBGI, GPL-2.0) compiled to WASM: the cheap route when it
  covers the build. Route B is an own VM written from an opcode spec, for when it does not. Either way, an opcode
  census on the boot path must show zero unknowns before the route is chosen.
- **Native tools.** Disassembly with capstone and pefile (`tools/x86dis.py`) and a Ghidra decompile through a REA CLI as
  the second path. Ghidra's return values in thiscall or stack-cookie functions can be wrong; check them against the
  disassembly.
- **Waits and input.** Scenario waits are timed waits that input on their layer can end early (a click or a press).
  Holding a modifier key did not end the logo waits in the browser port, so test each input kind before designing a
  skip (DECISIONS, 2026-10-18 E9).
- **Output size.** Pictures and voices dominate the download. A lossy setting is a per-image choice that needs a
  paired sample with a PSNR figure (DECISIONS, 2026-10-18 E3, "paired").

## 6. Subahibi-only assumptions (check before copying)

- An open reimplementation existed for this build (route A). Most engines need route B, an own VM.
- Cloudflare Pages limits (20,000 files, 25 MiB per file) and the 256 KiB block size chosen from them.
- WSL Ubuntu-26.04 with Emscripten 6.0.12; Windows paths; call WSL from PowerShell, not from Git Bash.
- The REA CLI and the Ghidra setup behind `native-query`.
- CPU x4 throttling as the stand-in for a phone, and the Chrome channel on Windows.
- The budget numbers (title within 3 s warm and 8 s cold; download before the title 15 MB; memory 300 MB; playthrough
  1536 MiB). Each game sets its own numbers from its own target device.
- Ports: dev 5417, preview 5440, board 5461 and up.
- The user decisions already taken for this game (domain, hosting, the GPL source offer).

## 7. Sources

Grep the decisions file by date or topic; never read it whole.

- `subahibi-port-kit/docs/03-SUBAHIBI-PLAN.md`, "Phases" (0-12) and "Agent allocation": stage order and who does what.
- `Subahibi/.claude/skills/re-loop/SKILL.md`: the evidence ladder, the labels and the timebox (section 2).
- `knowledge/PLAYBOOK.md`: stages S0-S7 and their gates (section 1).
- `knowledge/ENGINES.md`: "At a glance", "What transfers between them" (section 0, step 1).
- `knowledge/LESSONS.md`, 2026-10-18: "Browser-proof downloads" (app bytes against transferSize) and the "budget proof"
  entry (targets reported as facts).
- `Subahibi/docs/COMMANDS.md`: the command table behind section 3.
- `Subahibi/docs/DECISIONS.md`, grep: "Logo/warning screens" (2026-10-16), "paired" (2026-10-18 E3), "E9" and "V4"
  (2026-10-18).
- `Subahibi/docs/BACKLOG.md`, "Budgets vs now" (the section 6 numbers).
