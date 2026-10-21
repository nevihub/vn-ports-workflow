# AGENT-START: cold start in 10 steps (read this, then work)

You were given a repo URL and a game path, nothing else. This is the whole onboarding.
`AGENTS.md` stays canonical — this file only orders it for a first session. No game files
live in this repo (no scripts, art, audio, exes, fonts, story text); you bring your own
legally owned game, and game data lives only in ignored folders.

1. **Land.** Clone the repo, `cd` into the game folder. Confirm the toolchain: `npm run doctor`
   (read-only preflight; `--strict` in CI). If it reports missing required tooling, stop there.
2. **Rules.** Read `AGENTS.md` (the work loop + hard rules), then the game's own `AGENTS.md`.
3. **State.** Read the game's `HANDOFF.md` top block, then `git status` and `git log -5`.
   Never discard work you did not write; one writer per checkout (parallel agents use worktrees).
4. **Goal.** `npm run issue -- goal` — Playable yes/no, board %, current stage. Say it in one line:
   "advance \<stage> by finishing \<tickets>".
5. **Learn first.** `npm run kb -- "<words>"` plus the lesson log at the end of
   `knowledge/LESSONS.md` — another port likely solved your problem already.
6. **Pick.** `npm run issue -- next --agent <you>` (skips claimed, blocked, `U`, unmet `Needs:`,
   other worktrees). `claim` before working and record `--model "<actual model>"`.
   Give the ticket a `Proof:` (`npm run <script>`) if it has none.
7. **Work and prove.** Meet the `Gate:` with measured evidence (counts, hashes, report paths —
   never story text). `npm run firewall` before every commit; keep `npm test` green.
   Commit locally in small steps. Never push, deploy, or publish unless the user said so in chat.
8. **Close.** `npm run issue -- done <ID>` runs the `Proof:` first and refuses to close on failure —
   fix the work, never the checker. A human waiver (`--waive-proof "<why>"`) or a user answer on
   a `U` ticket (`--user-ok "<what the user said>"`) is recorded in the ledger, never silent.
   Then `audit`, file follow-ups with `issue new` (each with `Plain:` + `Gate:`), and update `HANDOFF.md`.
9. **Record.** One `issue learn "<lesson>"` when another port could use it. The `why` of a
   decision goes in the game's `docs/DECISIONS.md`.
10. **Stuck is a state, not an ending.** Gate failed twice → `issue block`, write what you tried
    in the handoff, take the next ticket. Every block records a way forward
    (`issue recovery <ID> --unblock "..." --related ... --topics ...`). Before reporting
    "nothing left": run `rescue` + `audit`, re-read related cards, `reviewed` what you checked.
    Reopen only on new evidence or a verified implementation change. Ask the user only for:
    push/deploy, game content on a new site, money, destroying data, changing a locked checker,
    or a new direction no default covers (`knowledge/DEFAULTS.md` decides everything else).
