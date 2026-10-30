# Standing defaults (decide with these; don't ask)

The user has decision fatigue and wants every port to run autonomously (2026-10-16, again 2026-10-18). These are the
choices made on Saya and Subahibi. Apply them to every port by default, record each use in that game's
`docs/DECISIONS.md` (decision, evidence, rejected alternative), and mention it in the next report. A game may override
a line in its own `AGENTS.md`/`CLAUDE.md` (Saya is a faithful 1:1 port; Subahibi and Sakura put compatibility first).

## Product
- **Order:** playable start to finish first, then optimization. Compatibility/performance over pixel parity; comfort
  over native fidelity when the native behaviour is annoying (except on Saya, which stays 1:1). The bar is Subahibi:
  not pixel-exact, but at a glance it looks and plays like the original - transitions, fades, logo timing, menus
  and input feel match; a visible difference is a bug unless it is a listed comfort default (user, 2026-10-30).
- **Skip:** hold-to-skip on Ctrl and on a touch Skip button (a native toggle was reverted on Saya). The in-game
  SKIP button and the text-skip setting keep native behaviour.
- **Intro:** logos, warnings and opening are click-skippable even on the first launch.
- **Text:** default speed 4/5 (not instant); a slightly larger story font is fine (Saya 1.15x); fix iOS text rendering.
- **Page:** scales to fit the window; the site root is the player; tab title = the game's English title + its icon;
  "Loading x / total MB" bottom-left; nothing laid over the picture.
- **Mobile:** touch bar (Menu, Backlog, hold Skip, Hide) with a hide option; long press = right click; install as
  app (manifest + icons; service worker opt-in only, shell-only cache, never precache the game); movie sound must work on iOS (unlock the video on the first tap). The
  user tests on an iPhone 16e (Safari + Add to Home Screen).
- **Saves:** export/import file for moving between devices.
- **Audio:** a bigger buffer is fine (adaptive lead, up to ~1 s before fetches).
- **Performance:** draw/fps cap, no draws while hidden, `?perf=1` readout with a downloadable log (files, not
  screenshots) and a way to fold the readout away.
- **Data:** the user hosts the game data; never design for players bringing their own files.
- **Hosting:** Cloudflare Pages on `<game>.example.com`; never paid storage - split big files into <25 MiB parts.
  Each new domain needs one approval from the user.

## Process
- Long commands (> ~1 min) run in the background and are listed in the handoff file; never poll with sleep loops.
  While one runs, start the next independent piece of work unprompted (one that does not touch what the job reads
  or writes) instead of idling (user, 2026-10-16).
- Concise replies, result first, led by **Playable: yes / no (blocked by X)** and the board-computed progress %
  (`npm run issue -- goal`); never a hand-typed %.
- Small local commits; one writer per checkout (parallel agents use their own git worktrees).
- Evidence over guesses: a guess in code is `// shortcut: <limit>, <when to upgrade>`; RE claims are PROVEN / STRONG
  / LEAD; a subagent's report is a claim until checked.
- Escalation: after **two failed attempts at a ticket's gate**, `npm run issue -- block <ID> --reason "..."`, write
  what was tried into the handoff top block, and move on to the next ticket.
- Cheap models/subagents (Claude: Haiku; Codex: gpt-6-luna) for repetitive checks; the main model decides.
- Input/UX changes players can feel: write native behaviour, port behaviour, the difference and what could break
  nearby into `docs/DECISIONS.md`, verify with a proof, then ship it locally and report. Input changes you cannot
  reproduce locally go behind a `?flag` so the user's device decides.

## Still ask (and only these)
- Pushing to a git remote or **deploying** to any site (user, 2026-10-18: agents commit locally only; the user
  deploys or says "deploy" in chat each time).
- Game content on a new site or domain; anything that costs money.
- Destroying the user's data, or other irreversible actions outside the repo.
- A new direction no default covers (ask once, recommended option first) - and starting a `U` ticket.
