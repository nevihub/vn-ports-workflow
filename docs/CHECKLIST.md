# Per-ticket checklist (the loop that moves a card to DONE)

For the full loop see `AGENTS.md`. This is the short version taped to the monitor.

## Take a ticket

- [ ] `npm run issue -- goal` — know the stage and Playable yes/no.
- [ ] `npm run issue -- next --agent <you>` — pick ready work (skips claimed/blocked/`U`/unmet `Needs:`).
- [ ] `npm run issue -- claim <ID> --by "<agent> <worktree>" --model "<actual model>"` — one writer per checkout.
- [ ] Ticket has `Plain:` (user-readable) and `Gate:` (how we know it is done). If `Proof:` is missing, set it: `npm run issue -- proof <ID> "npm run <script>"` (only `npm run`/`npm test`, plain args).

## Do the work

- [ ] Smallest correct change. A test for any non-trivial logic.
- [ ] Evidence, not guesses: counts/sizes/hashes/file names only — never story text. RE claims labelled PROVEN / STRONG / LEAD. Guesses in code marked `// shortcut: <limit>, <when to upgrade>`.
- [ ] `npm run firewall` before every commit. `npm test` + typecheck green.
- [ ] Commit locally in small steps. Never push, deploy, or publish unless the user said so in chat for that deploy.
- [ ] `progress` as it moves (`--percent N "plain words"`); if waiting on a job/machine/ticket, say what + `eta` + one `say` line, refreshed as the wait moves.

## Close it

- [ ] Gate met with measured evidence (counts, timings, report path).
- [ ] `npm run issue -- done <ID> --note "plain outcome" --before "..." --after "..." --evidence "..."`.
  - `done` runs `Proof:` and refuses to close on failure → fix the work, never the checker. Never invent a before benchmark; say when none was recorded.
- [ ] `npm run issue -- audit` — apply what is right (reopen unblocked, add `Needs:`, file follow-ups with `issue new` + `Plain:`/`Gate:`).
- [ ] One `issue learn "<lesson>" --tags a,b` if another port could use it. `HANDOFF.md` top block updated (≤60 lines).

## If stuck

- Gate failed twice → `issue block <ID> --reason "..."`, write what you tried in the handoff, take the next ticket.
- Record a way forward: `issue recovery <ID> --unblock "missing evidence or change" --related ... --topics ...`.
- Before reporting "nothing left": run `rescue` + `audit`, re-read related finished/in-progress cards. Reopen only on new evidence or a verified implementation change — never by weakening a checker or retrying the same failed attempt.
