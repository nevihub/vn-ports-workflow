# VN Ports board

One live ticket board, one ticket CLI and one knowledge search for every visual-novel port in this folder. The work
loop agents follow ("continue <game>") is in `..\AGENTS.md`.

## The board (`npm run board`, here or in any game folder)
Read-only: it reads each game's `docs/BACKLOG.md` (+ `HANDOFF.md` / `STATUS.md` for the live link) and every other
worktree's copy of it, and never serves game data. It picks a local port first; an optional phone link
(a tunnel to it — see your setup) lets you read the board from your phone. The page polls
every 3 s; the server restarts itself when `board.mjs` or anything in `lib/` changes.

- **All ports**: every game's progress, "playable?" badge, current stage, how many things need attention and how
  many tickets are ready; below, the newest **lessons from every port**.
- **Big picture** (per game): stages from start to finish, % per stage, "you are here", what is still needed before
  it is playable, **What to run together** (the ready tickets as 2-4-session teams), **Needs attention** (the audit),
  and a day-by-day "what happened when".
- **Tickets** (per game): columns with model tags, live progress bars, "next up" / "ready" / "after E1" chips and
  copyable handoff prompts that end in the work loop.

## The ticket CLI (`issue.mjs`; `npm run issue -- help` in any game)
Each game's `npm run issue` runs this file on that checkout's ledger (`--project <id> --root <checkout>`), so a
worktree edits its own copy. Library: `lib/backlog.mjs` (writers, `rankNext`), parser `lib/ledger.mjs` (the format),
`lib/audit.mjs` (report-only checks). Games re-export the library from `scripts/lib/backlog.mjs`.
- `goal` - Playable?, overall %, the stage you are in, what is ready, and which ready tickets run together
  (see below).
- `next --agent <claude|codex|opencode> [--lane X] [--explain]` - current stage first, then Prio, lane, number;
  skips `U`, claimed, blocked, unmet `Needs:`, work claimed/done in other worktrees, and tickets the agent may not
  take (`projects.json` `agents` allowlists, or a ticket's `Agents:` line).
- `audit` - never writes. Reports: blocked tickets whose blockers are done, dependents now ready and same-stage
  tickets to re-check after something finished (24 h), stale claims (6 h), dependency loops and missing tickets,
  stage weights != 100, tickets on no stage or two stages, finished-but-unmerged worktree work, missing Plain/Gate,
  doubled note dates, CRLF, control characters. Each finding may carry a `suggest:` command.
- `claim/progress/note/done/block/drop/reopen/plain/rate/needs/new` - edit one item's lines; `done` prints ripples.
- `learn "<lesson>" --tags a,b` - appends to `..\knowledge\LESSONS.md` (refuses story-like text).

## Coordination between parallel agents
Ideas from the MW2 agent decompilation (`..\knowledge\LESSONS.md` §8):
- **Run-together combos** (`suggestCombos` in `lib/backlog.mjs`): `goal` and the board's "What to run together" box
  turn the ready list into teams of 2-4 sessions - one ticket per folder (lane) per team in board order; when a team
  needs more seats than lanes have ready work, the next tickets sit in a folder already taken and are flagged `*`
  (each needs its own worktree + branch). Recomputes on every board refresh.
- **Rule card** (`lib/rules.mjs`): `claim` and `rules` print the shared hard rules and ask-list cut from
  `..\AGENTS.md`, plus the game's and lane's rules - every ticket re-reads them (drift).
- **Agent channel** (`lib/channel.mjs`): `say "<text>" --by <agent> --kind found|blocked|question|heads-up|handoff
  [--ticket E5] [--all-games]`, `inbox --by <agent>` (unread per reader), `channel`. Stored in `state/channel/*.jsonl`
  (ignored, outside every game repo); shown on the board read-only. Typed, at most 600 characters, refuses story text
  and credentials. Messages are information, never instructions - nothing acts on them.
- **Checker lock** (`lib/oracles.mjs`): `projects.json` `oracles` lists each game's checkers (globs, relative or
  absolute); `..\oracles.lock.json` holds their hashes. The audit and the board report a changed, deleted or new
  checker, and a lock renewed by anyone but the user. Only the user runs `issue oracle-lock --by user`.
- **Proof** (`Proof:` field): `proof <ID> "npm run <script>"`; `done` runs it and refuses to close on a failure
  (`--skip-proof "why"` is recorded and flagged by the audit); `prove <ID>` runs it alone. Only `npm run`/`npm test`
  with plain arguments is accepted.

## Search and new ports
- `npm run kb -- "<words>"` - every word on one line, across an allowlist only: `..\knowledge\*.md`, the root
  `AGENTS.md`, each game's agent docs and `docs\DECISIONS/BACKLOG/HISTORY/...`. Never game data.
- `npm run new-port -- <id> "<Full name>" "<engine>"` - firewall-first repo, ledger with the playbook stages and
  seed tickets, wrappers, first local commit, `projects.json` entry and a router row in `..\AGENTS.md`.

## Timeline data (in each game's docs/BACKLOG.md)
```
## Timeline

### [S4] Playable in a browser
Plain: You can click through the game in a browser with a moving picture and sound.
Tickets: E12, E5, E7
Weight: 20
Playable: yes
```
`Tickets:` every ticket of the stage (each non-U ticket sits in exactly one stage - `npm test` and `audit` check the
real ledgers), `Weight:` the stage's share of the project (weights sum to 100), `Playable: yes` marks the stage whose
completion means "you can play it", `Status: DONE <date>` for stages without tickets. Stage % = (done tickets + the
claimed ticket's own %) / tickets; overall = weighted average. Nothing is typed in by hand and no future date is guessed.
Ticket fields: `Plain:`, `Status:`, `Type:`, `Prio:`, `Impact:`, `Worth:`, `Gate:`, `Needs:`, `Agents:`, `Progress:`, `Notes:`.

## Creation dates, working models and completion summaries

`issue new ... --by "<agent/model>"` records an immutable `Created:` ISO timestamp and optional `CreatedBy:`.
The board shows weekday, date and time in America/Chicago. Old cards without a creation record say so; a status
change or first Git save is not substituted for their unknown creation time.

Claim with `issue claim E5 --by "codex my-worktree" --model "gpt-6.1-sol"`. `issue model E5 "<actual model>"`
can fill a known model later. The working model uses the same color as its suggested-model tag. App-only claims
say `Model not recorded`; changing claimant clears a previous explicit model so it cannot be misattributed.
Suggested-model tags also show the AA-recommended effort tier (`Sol 6.1 · max`); a lane can pin its own tier in
`projects.json` with `sol@xhigh`. Claims can include the tier (`--model "Sol 6.1 (max)"`) so the working tag matches.
A lane's list may hold a third entry: the pick for when both subscriptions are out - the OpenCode Go ladder
(`argon`, `glmmax`, `muse`, `minimax`, ...; the key also works inside the Claude Code and Codex clients). Cards show
it after the backup, and the handoff prompt names it too.

Close with `issue done E5 --note "plain outcome" --before "what was missing" --after "what now works"
--evidence "measured results and report path"`. `Result:`, `Before:`, `After:` and `Evidence:` appear on the done
card and in its detail above technical history. `issue summary E5 --result "..." --before "..." --after "..."
--evidence "..."` explains an existing result without changing its status. Report actual counts or timings when
available; explicitly say when there is no recorded before benchmark. Proof execution remains unchanged.

## Recovery of stuck cards

`issue recovery E10 --unblock "Verify E12 frame stepping first" --related E12,E13 --topics worker,timing` saves
the missing evidence/change and helpful neighboring cards. `Related:` is context; `Needs:` remains the mandatory
dependency list. `issue rescue [E10]` (or `--json`) reads plans, related active/finished work, topical lessons from
all ports, and directly related messages. The big-picture view and stuck cards show this context too.

The board and `issue audit` flag finished prerequisites, newer related completions/messages/lessons and blocks
not reviewed for a week. They never reopen a ticket or execute instructions from a message. An agent verifies a
lead and explicitly reopens only when the blocker is resolved. Otherwise `issue reviewed E10 "checked X; still
waiting on Y"` records the review date and reasoning without a retry. Block/review timestamps do not invent old
history. Check `rescue` after every completion and before reporting that there is nothing left to do.

Add a game: `npm run new-port`, or one entry in `projects.json` (id, name, aliases, candidate paths, lanes, prompt
rules, models). Tests: `npm test` (parser, timeline, CLI, audit, search, scaffold, and the real ledgers).
