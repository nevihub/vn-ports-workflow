# Saving usage (Claude and Codex)

Ranked by impact. Most savings come from loading and reading less, not from installing anything.

## 0. Cut long carried contexts at ticket boundaries

The 30-day local-log audit supplied on 2026-11-03 found Claude at 28.3K requests and 7.9B tokens: median prompt
245K, p90 498K, and 81% cache reads. A fresh Claude session started at 73-89K tokens before work, about 29% of
usage. OpenCode averaged 132K across 21K requests, with 52% above 128K; REA alone exposed about 250 tools. Tool
output was only ~20 MB in 14 days. The main cost is carrying and rereading long sessions; startup context is second.

The 7-day pre-change report (`npm run tokens -- --source claude --days 7` and `npm run tokens -- --days 7`,
2026-10-28 through 2026-11-04) measured Claude at 4,751 requests / 32 sessions, 237K average, p50 208K, p90
411K, 84.8% above 128K, and 53.2% above 200K. Its 31 fresh sessions started at 86K average (p50 87K). OpenCode
had 8,082 requests / 49 sessions, 118K average, p50 119K, p90 183K, 44.3% above 128K, and 0.8% above 200K;
48 fresh sessions started at 15K average. Re-run both commands after a week to compare the same rolling window.

Use smaller auto-compact windows (Claude Opus 200K, Haiku 150K; Codex 200K) and moderate default effort for routine
work (Haiku medium, Codex high). OpenCode `compaction.buffer` is context left free, not the trigger threshold: the
existing numeric `800000` means an approximately 200-249K trigger for its 1M-context models. Keep specialized MCP
tools out of the default agent and enable them only in dedicated agents. After a ticket is finished and HANDOFF is
updated, stop when context exceeds ~150K; start a fresh session with HANDOFF and `issue next`. Estimated Claude
token reduction from shorter sessions is 40-50%; this is an estimate, not a measured outcome.

Targets for the next weekly report: Claude p50 below 150K, fewer than 10% of requests above 200K, and fresh-session
baseline below 50K. Tool-output size is not the target metric.

## 1. Small startup docs
- `HANDOFF.md` top block: **≤ 60 lines**, current state only. Move finished history to `docs/HISTORY.md`,
  read on demand. (Saya's grew to ~600 lines, about 25k tokens, re-read every session.)
- `CLAUDE.md` / `AGENTS.md`: rules and pointers only, no logs. They load on every session.

## 2. Load only what this project uses
- Disable unrelated connectors for coding sessions (Gmail, Calendar, etc.). Enable REA only when doing RE work.
- Disable the `superpowers` plugin for this project: it injects a large block at each session start and adds
  planning steps. Keep `ponytail` (small; matches the smallest-change preference) and `context7` (docs lookups
  are cheaper than web searches).
- Install nothing that adds its own startup text in the name of "saving tokens".

## 3. Right model for the job
- **Claude:** Opus for engine decisions and hard debugging; Sonnet/Haiku for routine edits, test runs, reports.
  Lower reasoning effort for mechanical work. Keep the Concise output style.
- **Codex:** `gpt-6-luna` for subagents and routine work; lower reasoning effort when the task is simple.

## 4. Short contexts
- Start a fresh session per task; `HANDOFF.md` carries the state.
- `/compact` (Claude) when a session gets long; `/clear` between unrelated tasks.

## 5. Scripts do the heavy reading
- Every tool writes full output to ignored `re/` and prints a one-line summary (Saya: `verify`,
  `native-query`, firewall).
- Never read decompiled scenarios or `._bp` listings whole: grep them or use the masked viewer on a range.
- Read file ranges, not whole large files. Grep before Read.
- Cache expensive results (Ghidra by exe digest, asset decodes by hash), and check the cache before rerunning.
- Targeted tests while working; the full suite only before commits.
- Repeated checks become scripts, not repeated agent work.

## 6. Batch
- Agents ask all open questions at once and run independent commands in parallel.
- The user gives feedback as one list per message.
