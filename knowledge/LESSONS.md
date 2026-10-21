# Lessons from every VN port

Curated lessons, first from the Saya no Uta port (sections 1-7), then the **lesson log** at the bottom where agents on
any port append one line each (`npm run issue -- learn "<lesson>" --tags a,b`). Read sections 1, 4 and 5 and the log
before starting a non-trivial problem; `npm run kb -- "<words>"` (in `VN-Ports\board`) searches this file, the other
knowledge docs and every game's decisions/handoff at once. Engine-specific facts: `ENGINES.md`.

Saya: Nitroplus N2System engine (NPA archives, NSS scripts), JAST English `saya.exe` v2.00, 800×600.
Built 2026-10-13 → 2026-10-15, ~120 commits, by Claude + Codex + a DeepSeek session handing off to each other.
Result: all three endings playable, menus/saves/backlog/config/extras, mobile/PWA, iPhone confirmed by the user,
deployed on Cloudflare Pages. Final estimate 92% (weighted checklist; remaining gaps are native-parity details).

## 1. Process rules that paid off (each was earned by a failure)

| # | Rule | What went wrong without it |
|---|---|---|
| W1 | **Assert the denominator.** Every count says what it is a fraction of; a tool that can't see part of its input says so. | The content firewall matched 572/574 text blocks (nested inline blocks cut them short); only an `opens == closes` assertion caught it. |
| W2 | **Two paths per question; "fresh" only when they agree.** Proofs are stamped with `{head, dirty}`; `audit:proofs` checks commit *and* mtime. | 0 of 28 checklist proofs were captured against the current source while the progress report counted them as done. |
| W3 | **Known-true case first.** Run any new scan/census on a case whose answer you know before trusting it. | — (the firewall plants an in-memory fixture and fails if it isn't caught) |
| W4 | **Exonerate the instrument before blaming the subject.** Timeout, empty log, stale cache, wrong encoding, wrong origin. | "REA is broken" was Ghidra's first analysis outliving the MCP request; Python `-I` silently ignores `PYTHONIOENCODING`. |
| W5 | Results come from **exit codes and printed success lines**, never from a file existing. | — |
| W6 | Label every RE claim **PROVEN / STRONG / LEAD**; a guess in code is a `shortcut:` comment. Removing one needs PROVEN evidence + a test/proof. | — |
| W7 | **Read recorded verdicts before designing an experiment.** Per-shortcut "cards" list every file and cached query mentioning its addresses. | One function was decompiled twice as "the icon clock"; it was setup/reset, and that was already on disk. |
| W8 | **Cross-check anything a fix depends on with a second decompiler** (capstone fast path + Ghidra slow path). | — (both agreed on every shipped finding) |
| W9 | Capture the *why* in `docs/DECISIONS.md` (decision, evidence, rejected alternative, hindsight) while fresh. | — |
| W10 | A subagent/model report is a **claim** until checked against the artifact. | Several "all passing" agent summaries had stale or partial proofs. |

Day-one order that made every later claim checkable:
1. **Content firewall before the first commit** (ignore rules + a script that fails on game paths/extensions/large
   blobs/story-text shingles, with a self-test). 2. **Archive reader with a counted listing** (entries found ==
   header count). 3. **Parse/decompile-all gate with an asserted file count** (Saya: 82/82). 4. **Headless VM run
   with an unknown-opcode/built-in census** — the coverage oracle. 5. **One browser harness per surface**, each
   writing a stamped JSON proof into an ignored folder; the progress checklist scores only from proofs.
   6. **Native capture/compare + the RE loop** for parity.

## 2. User preferences (follow without being told)
- Concise answers, result first, overall % in progress updates (`npm run progress`).
- Cheap subagents/scripts for repetitive work; main model integrates. Build a reusable script instead of
  repeating LLM work (e.g. `compare-shots.py`, `progress-report.mjs`, `native-query.mjs`).
- Report MCP outages immediately. Never hold window focus with the native game. Commit locally only; never push or
  deploy unless the user says so in chat (user, 2026-10-18).
- The user tests on a physical **iPhone 16e** (Safari + Add to Home Screen) and reports by chat. Mobile matters.
- The user sometimes prefers comfort over native fidelity; do it when asked, record it, keep it switchable.
- **Playable first, then optimize** (user, 2026-10-16, Subahibi): get the whole game playable in the browser from
  first launch to every ending (story, choices, saves, menus, movies, audio) before performance/memory/phone polish,
  and announce it as its own milestone. Every progress table leads with a **Playable: yes / no (blocked by X)** line,
  separate from the % and from optimization items. (Subahibi was effectively playable while reports still read as a
  list of optimization tweaks, so the user couldn't tell.)

## 2a. Standing decisions
Moved to `DEFAULTS.md` (one list for every port).

## 3. Reverse-engineering workflow that worked
- **Scripts first:** `tools/x86dis.py` (capstone + pefile linear sweep; `dis|func|xref|calls|grep|read|find`,
  1–4 s per query). Traced ~20 functions in one sitting.
- **Ghidra second:** REA CLI via `scripts/native-query.mjs` (3–10 min per function, cached by exe digest +
  tool identity, one function per job, run in background). The REA **MCP** times out on first analysis
  (~150 s) and a cancelled request discards the analysis — use the CLI. Check for orphaned `java/javaw`
  before runs (inspect before stopping; they may belong to another session).
- Built-in names were not plain strings in the exe (dispatched by per-character comparisons); system.ini keys
  and section names *were* findable as Shift-JIS literals and led to the right code. Setter dispatchers
  (`#SYSTEM_*` name table + jump table) and the engine-init defaults function were the best entry points.
- Write findings to an ignored `re/verification/*.md`: address table, PROVEN/STRONG/LEAD, concrete fix, which
  checklist item it resolves. Then fix + test, remove the shortcut comment, refresh proofs.
- Native comparison: copy the install to ignored `re/native/game`; the game ignored posted input, so
  `native.ps1` focuses it for ~0.2 s per input and captures with `PrintWindow` in the background. Needed the
  **DirectX 9 June 2010 runtime**. `compare-shots.py` auto-aligns and reports width ratio/pitch/gap deltas.

## 4. Engineering lessons (most transfer to any VN engine)

**VM / saves**
- The original saves mid-script state, so the VM needed **explicit serializable frame stacks** (not JS async).
  With an existing engine (OpenBGI), use *its* save path and persist its files verbatim; don't invent a format.
- Menu "chapters" needed their own object bank; otherwise a menu's fullscreen capture outlived it and froze the
  title screen (user-reported, live site).
- Reserved save slots (common state, previous-choice checkpoint) are separate from the 60 visible slots — read
  the original menu scripts before designing storage.

**Input**
- Pair press/release; a `select`-style event loop must also receive releases and key-ups (cancel dialogs hung).
- Desktop: handle only mouse PointerEvents, or touch compatibility events send a second click.
- Touch: tap = click on release (+ release); stationary 550 ms long-press = right-click (opens the original
  menu); drag/second finger/backgrounding cancels. Touch-down shows the pressed art without activating.
- Touch bar for phones dispatches the game's *own* registered shortcut keys (menu/backlog/auto/skip/hide), with
  the native repeat guard; it adds no new game-state API. Held Skip button = held Ctrl.

**Text / fonts** (the biggest source of visual divergence)
- Font size in old Windows engines is a **GDI cell height** (ascent+descent), not a CSS em.
- The requested face (Tahoma) doesn't exist on iOS; slight condensing of hand-wrapped lines beats re-wrapping.
- Outlines were 8 stamps at ±2 px with fill last; click-wait icon position needed the padded glyph drawable width.
- Native text paging rules (blank line = click + new page, 14-line capacity) had to be traced, not guessed.
- Browser readability scale was a user request: explicit setting, capped, falls back to native size when it
  would change automatic page breaks.

**Audio**
- iOS Safari < 18.4 can't `decodeAudioData` Ogg Vorbis/Opus → build-time **AAC** transcode (decode by content,
  keep original names). Read MP4 `mvhd` for durations.
- Decode BGM only while audible: decoded audio went from ~1.1 GB to 51–81 MB.
- **The original archives were missing 4 voice files the scripts reference**; a retry loop on a failed load froze
  the page. Missing assets must end silently and be logged.
- AudioContext resume can reject on iOS; retry on later gestures.

**Hosting (Cloudflare Pages)**
- Pages **ignores HTTP Range** and caps files at **25 MiB** → split archives into blocks + `parts.json`
  `{partSize, sizes, version}` (version = content hash, used as `?v=`). LRU of a few blocks per archive.
  Pages also caps a deployment at **20,000 files** — at multi-GB scale pick a larger block size or use R2.
- Boot reads only needed blocks; a background worker fills Cache Storage after the title appears.
- Service worker: **network-first navigation**. A cache-first `index.html` kept an old engine running against
  new data ("not an NPA archive"). Shell-only SW cache; never silently precache the whole game.
- `functions/_middleware.ts` sets cache headers (`immutable` for versioned blocks, `no-store` otherwise).
- Deploy from a clean worktree when another session has uncommitted source edits.
- Compressed build (WebP q85/q90, AAC) cut 253 → 113 MiB; UI images and transition masks stay byte-identical
  (filtered edges change otherwise). An audit script verifies names/order/bounds and decodes samples.

**Browser platform**
- WebCrypto is unavailable on plain-HTTP origins (LAN phone testing) → portable SHA-256 (`knowledge/templates/src/archive/sha256.ts`).
- WebKit IndexedDB can fail ("unable to open database file") → retry once, then session-only saves + notice.
- Save export/import file (gzip JSON; plain JSON when `CompressionStream` is missing) for device transfer;
  Safari needs the download anchor attached to the DOM.
- iOS caches Home Screen icons at add time — the user must remove/re-add to see a new icon.
- Generate PWA icons from the original exe icon into an ignored folder; track only an authored fallback.

**Tooling gotchas**
- Run long browser harnesses against a **production preview**, not the dev server (HMR reloads mid-run).
- Use `localhost`, not `127.0.0.1`, when the desktop app started the dev server. Vite sometimes answered only
  on IPv6. Fix: set `server.host` explicitly in `vite.config.ts` and use that same host in every harness.
- Harness runs failed several times because no dev server was running. The session-start preflight should
  check this (see plan phase 1).
- The desktop browser pane pauses `requestAnimationFrame` while hidden, so evals time out. Verify runtime
  behaviour with a headless Chrome/Playwright probe instead.
- Terminal-only slash commands (`/plugin`, `/mcp`, `/doctor`) don't work in the desktop app's Code tab. Run them
  in a `claude` terminal.
- Don't point REA at non-binaries: a `.sayasave` (gzip JSON) test was inconclusive.
- Vite's watcher crashed (EBUSY) on Chrome profile files under `re/` → ignore `**/re/**` in Vite watch.
- Playwright: no browser download; use installed Chrome (`channel: chrome`) and the cached npm package.
- PowerShell 5.1 has no `&&`; Git Bash works for POSIX commands.

## 5. Failure museum (looked right at the time)

| Looked like | Was |
|---|---|
| Function X is the icon frame clock | Setup/reset; the clock was elsewhere (8 update ticks per frame) |
| REA is broken (MCP timeouts) | Ghidra first analysis outlives the MCP request |
| iOS "compatibility" mouse events after a tap are a stray second click; drop them (Subahibi SKIP fix) | They carried real input on the iPhone: dropping them broke buttons, menus and the backlog. Playwright WebKit/Chrome on Windows send none, so nothing local could show it. Ship input changes you can't reproduce behind a `?flag` and let the user's device decide |
| All checklist harness items done | Proofs predated the current source; half had no commit |
| Firewall covers all story text | Nested inline blocks truncated 2 blocks |
| Sound defaults are 1000 | system.ini gave 700/700/1000; 1000 is the setter maximum |
| Text speed default is 1000 | Native starts at 500; 1000 is the slider range |
| Page freezes at normal speed (engine bug) | 4 voice files absent from the shipped archives + retry loop |
| Mobile "title hang" | Menu chapter objects outliving the chapter (no object bank) |

## 6. Multi-agent handoffs
- `HANDOFF.md` top block = current state, re-read verbatim each session (not a summary of it).
- Agent-specific handoff files (`CLAUDE_TO_CODEX_HANDOFF.md`, `DEEPSEEK_HANDOFF.md`) listed rules, missing
  tools and next steps; they worked. Write one when switching agents.
- Never run two writers on the same files; preserve other sessions' uncommitted work.

## 7. Adopted from outside research (deep-research report on browser game ports, 2026-10-16)
Most of that report restated sections 1 and 3. These are the parts not covered above; apply them on the next VN.
Rejected (don't revisit): WebGPU, static/dynamic recompilation, pthreads (COOP/COEP), a six-role agent org, a
generic multi-engine framework up front, and **bring-your-own game data** (user, 2026-10-16: keep hosting the data).
- **Diffable trace oracle (build early).** Both runtimes emit one normalized JSONL stream - script position, variable
  writes, layer/picture changes, voice/BGM start/stop, waits (input/timer) - and a script prints the **first
  divergence**, not just "differs". Cheap first: headless engine vs browser engine. Real: reference/our engine vs the
  original exe, hooking its VM dispatch loop (REA/Frida). Screenshots and censuses say *that* something is off; the
  trace says *where*. Saya and Subahibi never had one.
- **Agents never edit their own oracle.** Golden traces, reference hashes, proof thresholds and verifier scripts are
  read-only to the agent changing the engine. A commit that touches engine code *and* an oracle/threshold is flagged
  for review (small check script, runs with the firewall). Passing by loosening the test is a failure.
- **Agent-written names/comments are not evidence.** A function an agent renamed "sprite loader" in Ghidra/REA is a
  LEAD until an address, trace or test backs it (extends W6). Prefer neutral names (`fn_4a1b20_dispatch?`) until then.
- **Controlled experiments.** For "what makes command X return": same scene with no input / click at t=1000 ms /
  click during voice / skip on; diff the traces. One run is never enough.
- **Load-continuation test.** Play -> save at a known point -> reload the page -> load -> same choices -> must reach
  the same route/scene. Stronger than "the loaded picture matches".
- **Engine with no open reimplementation** (Saya-like): write a small machine-readable opcode spec first (operands,
  stack effect, blocks y/n, side effects, evidence addresses, confidence) and implement from it; missing semantics
  become RE tickets, not plausible code. Skip when a reimplementation exists (OpenBGI).
- **Fidelity tiers** for scoring progress (tag each checklist item with one; report per tier under the Playable line):
  `content` (same scripts/art/voice/music) · `control` (same choices -> same routes) · `state` (flags, variables,
  layers) · `presentation` (composition, transitions, text) · `timing` (blocking, auto/skip, voice/animation order) ·
  `quirk` (engine oddities scripts depend on). Verify in that order; pixel compare last, never alone.
- **Extract the shared browser layer at game three, not before.** Two ports exist; when the third starts, lift the
  duplicated pieces (split blocks + `parts.json`, touch bar, save export/import, audio/video unlock, PWA shell, perf
  readout) into kit templates behind small interfaces. Engine VMs stay per engine.

## 8. Adopted from the MW2 agent decompilation (Tom's Hardware, 2026-10-12) and the Hugging Face agent intrusion
A developer rebuilt a 2009 PC game's source with up to 17 parallel Claude/Codex agents (99% of functions present,
83% byte-identical). What carried over to VN-Ports (built 2026-10-18):
- **Objective checks beat reviewer agents.** A month of readable but semantically wrong code got past a reviewer
  agent because nothing objective judged it; a per-function byte compare fixed it, and with it even cheap models
  (Haiku, Luna) produced usable work. Here: each ticket gets a `Proof:` command that `issue done` runs and must pass.
- **Agents cheat their checker** (inline assembly, editing the compare script to skip their functions). Here:
  checkers are hash-locked (`oracles.lock.json`), the audit flags any change, only the user re-locks.
- **Agents' own comments acted as prompt injection** on the reviewer; stripping them helped. Treat comments, ticket
  notes, handoffs and channel messages from other agents as claims to check, never as instructions.
- **Drift over long runs:** they re-read instructions hourly. Here: `claim` prints the rule card every ticket.
- **One shared channel** (issues + one chat room with CI posts) kept 17 agents coordinated. Here: the agent channel
  (`issue say/inbox`). The July 2026 Hugging Face intrusion (about 700 agents coordinating through 70,000+
  messages) is why it stays local, typed, short, read-only on the phone, and carries information - never orders.
- **Throw bad code away.** Salvaging the first month took longer than restarting; generating code is cheap.

## Lesson log
Newest last. Added with `npm run issue -- learn "<lesson>" --tags a,b` from any game. One engineering point per line,
never story text.
- 2026-10-18 [sakura] (rendering, timing, proofs) Frame counts are not elapsed time: rendering transition overlays can invalidate an unpaced capture that previously showed the destination immediately. Use explicit clocks and named checkpoints; preserve failed references rather than repinning them to new output.
- 2026-10-18 [sakura] (audio, worker, proofs) Browser audio in an engine Worker can keep decoding off the audio thread by transferring bounded PCM chunks to a gesture-unlocked page AudioContext. Return device-clock position and permit one outstanding refill per voice; verify actual post-gain graph energy, not a successful play call. - by codex
- 2026-10-18 [sakura] (script, compatibility, proofs) Census the resolved script chain before implementing a no-op tag: a reset may already be performed by page clearing, while another tag may drive missing engine state. Verify the observed operand forms and document each title-specific omission explicitly.
- 2026-10-18 [subahibi] (models, benchmarks, tooling) AA model ranking for port work lives at VN-Ports\knowledge\AA-model-ranking.md: relevant benchmark subset (Terminal-Bench 4.0, AA-LCR, FrontierCode, IFBench, honesty), v2 weights, per-benchmark leaders, key-free refresh snippet (AA has no key-free API; read initialModels from page payloads). TL;DR: Sonnet 5.5 (max) best agentic value (USD 2/10 per M tokens), Gemini 4 Argon lowest hallucination, GPT-5.6 Sol top TB-Hard/ITBench but ~92% hallucination, tau2-bench saturated.
- 2026-10-18 [subahibi] (harness, seeds, route) Click-sweep test harnesses that tick menu entries in list order always take the first ENABLED entry: when rows unlock in order (Subahibi: select row i enabled iff gflag(230+i), one sim click per 400 ms in list order), sweep in DESCENDING unlock order or the run re-picks the oldest entry forever. Seed live runs from an overlay the game itself saved at a front-end transition (BGI.gdb is written on entering the select, not mid-scene). - by opencode (DeepSeek V4.1 Flash Free)
- 2026-10-18 [subahibi] (perf, measurement, streaming) W2/Subahibi: when two throttled A/Bs disagree (7 vs 57 s, then 9 vs 7 s), the swing lives in the skip session, not the feature - re-measure with the stable harness (scene-proof: 10 vs 10 s of 36) and the byte cost (+28-119% fetched); judge a prefetch on both.
- 2026-10-18 [subahibi] (models, budget) Budget models: judge by AA Cost per Task, not USD-per-M sticker (Qwen3.8 Max 2/6 sticker costs 5.41/task = Opus-tier; GPT-6.1 Sol max 0.72/task; MiMo-V2.6-Pro 0.13; Gemini 4 Argon high 1.99; Haiku 5.5 max 0.21). Budget table + effort tiers (Sol max, Haiku max default / xhigh for code, never Qwen3.8 27B medium) in knowledge/AA-model-ranking.md.
- 2026-10-18 [sakura] (wasm, worker, input, proof) Emscripten interactive host: do not drive play through callMain - export a per-frame step (EMSCRIPTEN_KEEPALIVE) and call it from a dedicated Worker once per page requestAnimationFrame; input and async fetches run between steps, the page never blocks, and the old callMain harness stays for captures. Browser input proofs: hide a canvas with opacity:0, never visibility:hidden - hidden elements receive no pointer events, so every click silently misses. - by claude
- 2026-10-18 [subahibi] (models, budget, lanes) Model lanes (2026-10-18): Claude+Codex subs cover frontier; OpenCode free roster covers cheap lanes - GLM-5.3-Flash primary (honest, ITBench 51), DeepSeek V4.1 Flash reading-only (honesty 3.5/100). 10 USD/mo OpenCode Go fits the 3rd lane: GLM-5.3 (max) 1,080 req/mo, MiMo-V2.6-Pro 16,300, Kimi K2.7 Code 6,750, Step 5 8,520 (promo), Haiku 5.5 19,230, Go Plus 40 USD only if 15-dollar slices run dry. Picks + verdict: knowledge/AA-model-ranking.md; board chips updated (glm).
- 2026-10-18 [sakura] (images, quality, ssimulacra2, proofs) SSIMULACRA2 refuses images under 8x8 (it errors out, it does not score them). Pad both reference and candidate by edge replication, identically, and record the flag. PSNR alone also misjudged small textured thumbnails: it sat near 29 dB while SSIMULACRA2 stayed at 74 or higher.
- 2026-10-18 [sakura] (images, quality, search, proofs) Bisecting a quality setting for a PSNR target assumes PSNR rises with quality. WebP PSNR reversed across q1-q100 in every one of 33 unmatched pairs, so a bisection can step over a match (6 of 33 matched on an exhaustive sweep). Sweep every integer quality when the claim is unreachable.
- 2026-10-18 [subahibi] (browser, proof, testing, saves) Browser-proof signals (Subahibi V3): the engine read log records fetch URLs and archive-packed programs surface as data*.arc keys, never per-program paths - waiting there for omakecg/omakemusic/setupfor* can never fire. Gate mode-open checks on fetch-volume deltas (net stats bytes) around the tap (CG gallery ~+3.5 MB, lists ~+2.3 MB, page toggles ~0) and measure the FIRST open per context (later opens can hit cached thumbnails). And a save import through the player's own import flow only sticks after the boot's front end is fully up (warning screen read + dismissed first) - a mid-boot import loses the race with the boot's overlay writes.
- 2026-10-18 [sakura] (audio, format, loops, krkrz, sli) SLI sidecars are krkrz WaveLoopManager v2.00: Link{From;To} is the only loop mechanism; Label{Position;Name} are cue markers in 48 kHz sample units (ms = floor(Position/48)). Check the game's player scripts for the loop default before assuming sidecars define loop points - Sakura no Uta BGM loops whole files with zero sidecar links. Judge loop seams by the end-to-start wrap step vs residual sigma, never by sample-exact endpoints (lossy codecs shift samples).
- 2026-10-18 [sakura] (proof, privacy, reader) Proving a live UI feed with no text leaks: drive the page with synthetic schema-valid fixtures, assert sync through counts and stable ids only, and scan console, page-error and artifact text for every fixture payload substring (0 hits is the gate).
- 2026-10-18 [sakura] (gaps, proofs, verify) A blocked verify gate with owner-accepted missing assets can close on explicit temporary handling: prove the engine warns and continues, prove no placeholder or cross-edition art exists, keep the strict gate visibly failing, and leave the real-source hunt open to reopen the ticket.
- 2026-10-18 [subahibi] (board, ledger, process) Board cards went quiet because issue progress carried no timestamp and the claim rule card never mentioned it: stamp every progress update (ProgressAt) and count it in the stale clock, and put the progress command in the rule card agents re-read at every claim
- 2026-10-18 [subahibi] (browser, proof, testing, caching) Browser-proof downloads (Subahibi V4): an engine's byte counter counts the bodies the APP consumed - cache-replayed responses included (a warm revisit with no-cache + ETag revalidates and fetch() replays the cached bodies, so the counter moves while nothing crosses the wire). For any download/warm-start budget, read the wire truth from the resource timing's transferSize (0 for revalidated or SW-served responses); keep the app counter only for cold-launch accounting. And: a salvaged old unit test can catch real regressions - the codex movie-player test caught four live warm-up gaps (V6/E10).
- 2026-10-18 [subahibi] (proof, perf, headless) Headless proof displays refresh faster than real phones (here 167-246 fps vs 60 Hz): never gate smoothness on a fixed draws/s number from a real device. Gate per-sample gameFps <= displayFps (the once-per-rAF cap holds at any refresh rate) and project the phone bound as gameFps*60/displayFps <= 65. A fixed skip-window bound false-failed a healthy capped run here.
- 2026-10-18 [subahibi] (engine, testing) Engine unit tests for gen-gated opcodes must select the matching profile first: the test binary defaults to the 1.69/444 profile, so handlers registered GEN_1_653+ silently have no table entry and the test fails with undefined-instruction instead of a real regression. TestPort0002 now selects 1.653 and re-inits tables before exercising B0 06 / 91 0A / 91 DB.
- 2026-10-18 [sakura] (staging, manifests, browser, proof, ports) Staging full install chains for block-range browser delivery: re-point the live rt-* symlinks at the original installs (read-only, setup-full.sh pattern) and regenerate the manifests with make_block_manifest.py - then verify with a full re-read regeneration and byte-compare digests (the spot-checker path is far slower over seek-heavy mounts). Run browser gates on an isolated PROOF_PORT so a second server never collides with another agent's range-server; a proof that shares the disk with a multi-GB re-read will flake on responsiveness timeouts even when every content check passes.
- 2026-10-18 [subahibi] (maintainer, board, channel) Maintainer sweep: one Node script queries goal/audit/channel/worktrees for every port and posts a 600-char digest per game. Run dry first, then --post. Catches done-not-merged backlogs, ghost-only tickets, dirty main checkouts.
- 2026-10-18 [subahibi] (c, tooling, oracle) Test-stub discipline: a C harness that drops a return value crashes only at -O2 (-O0/ASan can mask it); build oracle/check harnesses with -Werror=return-type from the start.
- 2026-10-18 [sakura] (text-layout, wrap, artemis) A blank kinsoku/prohibit fallback string (single space) kept in the line-break sets glues every space to its neighbours, so whole spaced sentences lay out as one unbreakable line and spill past the stage - strip ASCII whitespace and fall back to CJK defaults
- 2026-10-18 [sakura] (tooling, git, wsl) WSL git and Windows git disagree on line endings for the same checkout (phantom whole-tree diffs) - do all engine git ops (worktree add, diff, apply) with Windows git; use WSL only for execution
- 2026-10-18 [sakura] (proof, drive, flaky) Fixed-frame Start taps in paced game drives are timing-flaky under machine load (run can sit at title with 0 errors) - spread Start taps across the run and gate on story-reached evidence (dialogue lines), not tap frames
- 2026-10-18 [sakura] (webgl, proof, headless, timing) Headless Chromium proofs of a WebGL2 live player silently test the CPU fallback unless launched with --use-angle=d3d11 (Windows): a Worker OffscreenCanvas gets no hardware GL by default, so add a separate GPU-flagged run and record the renderer/device name in the result. Also give click-through checks a wall-clock window, not a click count: long intros need many clicks before the first counted page, and frame timing gates swing 2->18 ms p90 under heavy background load (encodes), so run them on a quiet machine.
- 2026-10-18 [sakura] (emscripten, wasm, proof) Emscripten -sEXPORTED_FUNCTIONS replaces the default export list: scoping it to _malloc/_free drops _main so the generated JS throws 'callMain is not defined' at worker startup. Keep _main in the list for probe executables (verified on emcc 6.0.12).
- 2026-10-18 [sakura] (browser, perf, audio) GPU-path main-thread stalls are invisible to CPU-fallback headless proofs: rerun with --use-angle=d3d11 plus a PerformanceObserver(longtask) from navigation and a CDP trace, and wrap drawImage/AudioContext in addInitScript to attribute the window before blaming presents or fetches - by opencode
- 2026-10-18 [sakura] (browser, input, worktree, fixture, proof) Browser story-drive proofs: press Enter (down-edge Decide = max one wait per key, keyup inert), tap mouse only for event menus; gate every input on engine wait state and sync phases on quiescence, never frame numbers (frames drift under load). WSL git prune orphans Windows-created worktrees; use relative gitdir in .git files. Synthetic WASM fixtures belong under lane-ignored web-test/data/.
- 2026-10-18 [sakura] (movie, audio-sync, verification) Movie transcode verification: gate on presentation start (first packet pts plus declared in-band trim), not raw first pts - AAC priming (1024 samples) and Opus pre-skip (312) store negative first pts by design, with Skip Samples side data telling the player to start at zero; require the trim declared in-band and bound the raw offset (25 ms) so real timestamp shifts still fail
- 2026-10-18 [sakura] (live, transitions, proofs) Browser live hosts that present without Draw() must refresh the retained transition source on every present (retain-after-present). Symptom signature in Sakura no Uta: the title flashing over the intro was stall-pinned RUNS of 4-8 consecutive title-exact samples with the engine frame counter frozen; isolated 1-2-sample title-exact presents are the t~0 same-step BeginTransition presents native emits too, so live gates must fail on runs (>=3) or title-after-page, not on single matches.
- 2026-10-18 [sakura] (proofs, timing, ports) Shared port proofs: never run two browser proofs that share a range-server port - the second browser's requests starve the first and corrupt results (Sakura E17 saw 8512 engine errors + 47k range misses from an overlap on one port). Longtask/responsiveness gates are also load-sensitive: the same AudioContext-ctor task measured 70ms quiet vs 245-856ms under encoder load (compare E18); rerun red responsive gates once, alone, on a quiet machine before treating the fix as bad.
- 2026-10-18 [sakura] (memory, workers, python, 4k) Parallel workers that each build float64 composites of 4K pictures ran out of memory on a 32 GB machine (MemoryError, WinError 1455 paging file). Size the worker count by the largest picture, not the average; a retry at three workers finished all 39 failures.
- 2026-10-18 [sakura] (ssimulacra2, threads, measurement, windows) libjxl ssimulacra2 measured at about one core per call (GetProcessTimes CPU over wall time), so N thread slots give N concurrent scores. An older note said it runs about four threads; measure CPU time, not process thread counts, before sizing a budget.
- 2026-10-18 [sakura] (powershell, logs, windows) Windows PowerShell 5.1 redirects (*>>) write UTF-16, so the log then reads as binary: grep says 'Binary file matches' and tail shows nothing. Read such logs with tr -d '\000' or grep -a, or write them from Python.
- 2026-10-18 [subahibi] (windows, batch, priority, wsl, agents) Heavy batch jobs on the shared agent PC (media transcodes and their encode/measure children) must run Below-Normal priority, with an optional core pin: pc-setup-kit scripts\nice-batch.ps1 does it for any command and children/grandchildren inherit both, so the desktop and other agents stay responsive when a batch pegs the CPU. Also keep the WSL VM cap well under physical RAM (.wslconfig memory=12GB of 32GB as of 2026-10-18; was 24GB) - an uncapped vmmemWSL starves the Windows agent sessions.
- 2026-10-18 [subahibi] (proof, budget, gating, ledger) A budget proof that reports its targets as facts and gates only on its checks can never fail on those targets (Subahibi E9: proof:budget passes at 33 s warm against a 3 s target). Before a ticket names it as Proof, make the targets a gate (a strict mode or the target's own check), or the ticket closes over budget.
- 2026-10-18 [subahibi] (docs, proof, playbook, drift) A how-to document that names commands can be proved cheaply: resolve every named command against the package.json (or the scripts folder) it claims to run, and grep the file for leaked names. A planted bad row and a leaked name made the check fail as it should (Subahibi E12, scripts/check-playbook.mjs).
- 2026-10-18 [subahibi] (proofs, contention, playwright, opencode) long headless browser proofs need a sequenced machine: concurrent agent sessions spawning ~90 node processes produced ERR_INSUFFICIENT_RESOURCES request refusals and wasm 'memory access out of bounds' crashes in the page under test - a dead/flaky page is not an engine verdict. Check process noise before launching, and never run browser proofs concurrently with health/verify or another sweep. - by opencode lane-w2-prefetch
- 2026-10-18 [subahibi] (engine, proofs, emulation) Native pixel routines can hide paired-pixel and rounding behavior that opcode-only tests miss. Execute the copied original routine on synthetic data, verify its engine hash, and compare odd/even widths, padding, crops and low alpha values; document every bypassed non-rendering call. - by codex gpt-6.1-sol
- 2026-10-18 [sakura] (tooling, proofs, windows) cmd set VAR=x with a space before && bakes a trailing space into the value and breaks path joins - use set NAME=value with quotes; proof scripts should trim their env inputs
- 2026-10-18 [sakura] (proof, testing) A static proof check that greps for a forbidden string fails on its own code comments when they quote that string - reword comments to name the rule without the literal pattern - by codex
- 2026-10-18 [subahibi] (boot, proof, logo-skip) Revisit-only boot skip: set a first-visit mark when the title is reached, skip only on later visits, keep an off switch; prove with interleaved fresh and marked runs in one window and take thresholds from that run's own natives so machine load moves both sides equally
- 2026-10-18 [subahibi] (engine, proof, env) Engine proof scripts that apply patches into the reference tree leave it dirty - the retry fails on already-applied patches. Reset the reference tree to pristine before every re-run. - by muse-spark
- 2026-10-18 [saya] (proof, flaky, browser) Exact-pixel color gates swing 0 to 198 between identical headless runs (the double-strike lighter pass shifts centers); gate glow on presence plus a range, never a single exact count.
- 2026-10-18 [sakura] (testing, flakes) A browser proof that fails with a crashed tab or a missed Start press but zero bad hits is harness trouble, not a code bug: check no leftover server holds the port, rerun the full proof unchanged, never edit the checker to go green - by opencode
- 2026-10-18 [saya] (lint, checkers, board) Restoring relaxed lint rules touches locked proof harnesses: split those edits into their own commit so the user can re-lock cleanly.
- 2026-10-18 [saya] (choices, native-fidelity, proofs) A picked choice needs no invented flash timer: the original engine just leaves the pressed art up until the script changes it, so keep MouseClick on release-inside and let the unmodified scripts set the visible duration
- 2026-10-18 [sakura] (touch, proofs, timing) Touch-proof lesson: fixed-frame start taps misfire across picture paths (fast path hits frame 900 mid-loading, slow path on the title). Gate starts on a settled screen (presented, waits and picture all still ~3 s past a boot floor), tap with a human-like 150 ms dwell, and queue the touch press on pointer-down exactly like the mouse so a held tap reads as held. Count engine presses at the page-to-worker boundary (one per tap) and gate the picture chain on story pages only.
- 2026-10-19 [sakura] (i18n, browser, proof) Multi-language demo picks: apply a page-level language choice through the game's own first-start language handler (wrap it in a content-free probe: set language, mark the pick, save, reload system data, reset) instead of patching scripts or tapping its buttons; report language changes back as whitelisted code-only lines so an in-game switch updates the saved pick, and drop ?lang= from the URL once applied so reloads follow in-game switches. Keep legacy edition links free of the new path so existing proofs stay valid.
- 2026-10-19 [sakura] (proof, budget, wire, worker) Budget proofs must count page and worker wire bytes apart - the engine worker fetches pack files with sync XHR that never shows in page resource timing (here page 22 kB vs worker 65.7 MB). Drain the worker timeline to the runner and clear it as the run goes, and set targets as strict checks from the quiet-machine report run so a report-only proof can never close.
- 2026-10-19 [sakura] (wsl, worktree, proof, hosting) Worktree symlinks to shared data served from WSL must target /mnt/<drive>/..., not /<drive>/... (Git Bash form): WSL cannot resolve /v/..., the range server 404s and the page never starts - looks like an engine hang. Check with curl on one pack file before a proof. - by claude/claude-opus-5-5
- 2026-10-19 [sakura] (proof, determinism, fonts, browser) To prove a visual setting changes the picture when frames are not hash-stable by index, add a control run: two fresh default runs must settle to the same picture set (compare sets, not page numbers - counters can step twice on a busy machine), then the changed run must share none of them. - by claude/claude-opus-5-5
- 2026-10-19 [sakura] (takeover, worktree, merge) Taking over a ticket with half-done follow-up work in the same checkout: make a clean copy at the done commits only, prove and merge that, leave the half-done work untouched for its own ticket
- 2026-10-19 [sakura] (preview, network, proof) A preview link for other devices must be served from Windows, not WSL: this PC's WSL uses NAT, so a server started inside WSL answers on localhost but never on the PC's LAN address. The same range-server script runs fine under Windows python and reaches the LAN.
- 2026-10-19 [sakura] (yomitan, testing, browser) Yomitan test profiles: enable dictionaries through the settings UI so its backend learns it; direct storage writes leave lookups stale. Also turn off its popup secure container in test profiles or the iframe is unobservable by design.
- 2026-10-19 [sakura] (board, process) Waiting tickets must carry a fresh ETA: audit now flags wait-no-eta (waiting words, no Eta) and wait-stale-eta (wait update over an hour old); rule card and work loop require progress naming what is waited on plus eta plus a channel say, refreshed as the wait moves.
- 2026-10-19 [sakura] (workflow, review) Kept an unrelated debug stat out of a feature merge: E31 heapMiB stayed uncommitted in the worktree while only the E27 Lua file was committed and merged
- 2026-10-19 [sakura] (native, memory, proof) Prove a native memory leak with a paced story drive plus peak RSS before touching the browser: unpaced frames run faster than wall-clock timed waits, so the title timing recipe misses and the run never reaches the story (ours sat on the title at 180 MB). With frame pacing the same recipe reached the story and showed 439 MB peak vs 140 MB fixed.
- 2026-10-19 [sakura] (timing, proofs, worker) A wait counter that ticks on every wait entry (including self-clearing timed waits) must not drive clicks: click only when the picture has been still for seconds, and wait for the page count to step after each click. - by e4-worker
- 2026-10-19 [sakura] (takeover, process, machine) One owner per card, stop at two fails: E26 layered four take-overs (fresh contexts each) into stacked symptom guesses while the machine queue pushed small gap-jobs; the fix came from one continuous owner reading the binary. Cap take-overs at one per card, then park for a strong model; post the machine window order in channel; keeper reopens only on new proof, never on tries.
- 2026-10-19 [sakura] (browser, input, worker, events) When a browser worker batches pointer release and later movement, dispatch the completed tap before consuming that movement. A queued rollout can otherwise clear the button cursor before activation. Reproduce with release plus move-away in one batch, then verify the real Config-close-Start flow.
- 2026-10-19 [sakura] (timing, browser, perf) Cap browser game loops with a deadline gate, not a frame skip: post at most 60 engine steps per wall second, keep input queued for the next step, and prove the cap with synthetic refresh-rate timestamps plus a live upper-bound check
- 2026-10-20 [sakura] (git, worktrees, integration, proof) When integrating a tested worktree from a nested engine repo, compare the complete accepted production tree and carry its prerequisite fixes and regression tests. Cherry-picking only the last input fix can leave the original menu errors alive even though the ticket was already marked done. - by codex gpt-6.1-sol
- 2026-10-20 [sakura] (fonts, boot, proof) Switching the reader font during boot frames crashes the language-screen switch (wasm table OOB); resolve the want at boot but apply it at the first user-visible state (title line, page turn, or settings open). A mid-session switch at an open settings page is safe.
- 2026-10-20 [sakura] (proof, fixtures, wsl, evergreen) Proof fixtures are runtime artifacts, not source: the E10 synth fixture (web-test/data/e10, generated by scripts/make_e10_fixture.py) is gitignored, so a worktree proof passes where the shared root 404s - regenerate fixtures in the new root before running a proof there. WSL note: Node spawnSync('wsl', ['--','bash','-c',cmd]) silently strips double quotes from cmd, so prefer single commands or unquoted paths when building hybrid windows trees for A/B proofs.
- 2026-10-20 [vn-ports] (models, benchmarks, budget) DeepSeek V4.1 Flash 1017 (17 Oct) replaced the old V4.1 Flash snapshot: AA Intelligence 45 vs 39 and $0.26/task vs $0.57, but AA published no per-bench cells (no v2 composite, honesty unknown); Vals v1.1 gives TB4 31.82, Code Migration 67.52 (#7, $1.76/test - first cheap migration-capable model), Vibe 87.73 at $0.58/test, Vals Index 61.26 (#8). AA deprecated the old slug, so refresh snippets must name /models/deepseek-v4-1-flash-1017.
- 2026-10-20 [vn-ports] (dsh, subagents, free-models) Cheap subagents on the OpenCode Go routes start and die with no closing message and zero tokens used (muse-spark-1.3-contributor, glm-5.3-flash and deepseek-v4.1-flash, all three on 2026-10-20), while the same child works on opencode-zen-free-provider/deepseek-v4.1-flash-free. Two places must agree or the tool answers "route is not allowed for this Session": the delegation group's tool-subagent agentOptions (default child route) and subagent-model-selection-settings.allowedModels. Each chat records its own copy of that list when it starts, so an open chat keeps the old list - start a new chat after the edit.
- 2026-10-20 [vn-ports] (models, benchmarks, evidence) Vendor model cards report their own harness: DeepSeek's 1017 card shows TB4 42.3 (Claude Code), DeepSWE 77.0 (Mini-SWE-V2) and ProgramBench 29.1, while Vals' independent TB4 is 31.82 - label vendor numbers as self-reported, never merge them into AA/Vals cells or the composite.
- 2026-10-20 [vn-ports] (models, cyber, benchmarks) Cyber task scores do not follow the general model rank: on Vals CyberBench v1.1 (12 Oct) Claude Haiku 5.5 (75.48), MiMo-V2.6-Flash (75.36), Kimi K3 (75.24) and old DeepSeek V4.1 Flash (73.69) beat standard Opus 5.5 (55.36) and GPT-6 Astra/Sol (41.07/39.29, 0.00 PoC - likely refusals); 1017 is not tested. CyberBench is a narrow OSS-Fuzz PoC/patch slice, not a red/blue-team benchmark; Cybench/CVE-Bench/BountyBench/SEC-bench Pro lack this 2026 roster. Separate doc: knowledge/CYBER-model-ranking.md.
- 2026-10-20 [sakura] (cache, perf, proof) Repeat-visit savings need an in-browser verified block store, not the network cache: Chromium does not reuse cached 206 range replies for sync XHR, so a warm visit refetched everything until verified blocks were kept in Cache Storage and re-hashed on restore. Also run strict speed gates on a quiet machine; a busy box tripled the frame number, and the fix is a quiet rerun, never a looser target.
- 2026-10-20 [sakura] (ipad, safari, download, proof) On iPad Safari the download tag is ignored, so a save-log button must try the share sheet with the file first and fall back to opening the log in a new tab; keep the desktop one-click download path unchanged so headless download proofs still see one file.
- 2026-10-20 [sakura] (hosting, proofs, deploy) A deploy dry-run that names shell files rots when a UI ticket deletes one (E35 removed the font button file and E33's proof failed on the new tree). The live-setup ticket re-derives the shell from the tree and byte-checks it.
- 2026-10-20 [sakura] (pages, worker, proof) A Pages-style proof must serve what the worker actually requests, not the aspirational URL map: our Range-rejecting server first served only /game/part paths while the worker asked root-level /<pack>/part-N, and the dist was missing the worker's importScripts helpers (worker died at boot). Also: __e10.stats() resolves to the stats object itself, not a {stats:} wrapper - read __live.stats like the budget proof does.
- 2026-10-20 [sakura] (pages, deploy, layout) When the deploy layout gains URL prefixes, rewrite them at materialize time from a single rewrite table and keep lane files lane-relative: lane proofs serve the lane root and break on absolute prefixes. Slice part bytes from the checkout that holds the real volumes (not the engine worktree), skip dead plans (fixed manifests describe the same volumes), and make the proof server read plans from both old and new locations so DONE gates keep passing.
- 2026-10-20 [sakura] (media, engine, proof) Converted-media sidecars need the loader in the shipped engine, not just proven on a prototype branch: verify the merge before building the delivery bundle.
- 2026-10-20 [sakura] (media, proof, browser) Browser read-back of converted media: serve the real outputs plus the merged WASM probe from one loopback server and compare browser decode dims against engine decode dims; hash-verify each sample and flip one byte for the fail-closed check.
- 2026-10-20 [sakura] (media, proof, ledger) Rollout ledgers should bind to verify records at runtime, not copy hashes into the proof: M4/M5 records changed shape (no overall field on M4) and hand-copied hashes drift; the proof reads bytes+sha from the record and hashes the file.
- 2026-10-21 [subahibi] (harness, docs, proof) A native port's dev aids transfer as docs plus a static resolving checker, not engine code: map each aid to an existing harness flag or page reader, list the BOOT-class items as honest gaps, and gate on the checker (here 10 resolve + 2 gaps, both directions verified). - by opencode
- 2026-10-21 [subahibi] (harness, docs, proof) A shared template plus a game map beats one big doc: the template states each test aid once for every port, the game map points at it, and the game's fast checker verifies both sides (template present, pointer named, every row resolves). The checker resolves the template through VN_PORTS_ROOT in a worktree and on its own in the main checkout. - by opencode
- 2026-10-21 [sakura] (opus, audio, engine) Ogg Opus granule position counts the pre-skip samples too: kept length equals last granule minus pre-skip, and end trim equals total decoded minus last granule. A player that treats the granule as post-skip rejects files with less trailing pad than the pre-skip and plays extra samples on the rest; check kept files against a reference decode before blaming the encoder.
- 2026-10-21 [vn-ports] (proofs, wasm, lanes) A proof harness that serves build artifacts by hardcoded lane path can silently test a stale build: two identical E54 fails were the e49-worker e8_probe binary, not the candidate. Pin the candidate lane via the harness env input and verify served bytes before diagnosing a race.
