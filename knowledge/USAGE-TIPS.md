# Saving usage (Claude and Codex)

Ranked by impact. Most savings come from loading and reading less, not from installing anything.

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
