# Speeding up progress

Ranked by impact.

## 1. Reuse before building
- Decide route A vs B (plan phase 6) quickly. Spend about a day getting OpenBGI to boot, then choose from the
  measurements. Don't argue it on paper.
- Use GARbro / ethornell-tools as decoder oracles instead of reverse-engineering formats yourself.

## 2. Timebox investigations
- The compatibility goal allows it: if a native-behaviour question takes over ~1 hour, write a `shortcut:`
  comment with the best guess, add it to the handoff and move on. Come back only if the user notices.
- Native screenshot comparison is for bugs only, never for polish.

## 3. Fast feedback loops
- **Headless runner first.** Test VM/scenario logic without a browser (Saya: `scripts/headless.ts`), in seconds.
- **Jump to a scene.** A debug entry point (URL param or `window.game` call) that starts any scenario or loads
  a save checkpoint, so nobody replays from boot to test one scene. Build it early (phase 8).
- **Skip-mode route runs** with an unknown-opcode census, to cover the whole game in minutes.
- Develop with original or uncompressed assets locally; the compressed build is for deploys.
- Cache every slow transform (asset transcodes by content hash, Ghidra by exe digest). Full-game transcodes
  run in the background or overnight, are incremental, and use parallel ffmpeg jobs.

- **Measure the agent's own loop** (Subahibi, 2026-10-16): run independent verify steps (firewall, tests,
  counts, tsc) concurrently (health 14-23 s -> 9 s); cache content hashes by size+mtime with a `--rehash`
  escape (web build 12 s -> 0.3 s); fold the session-start ritual into one `npm run resume` call so the agent
  doesn't spend six round trips on git/health/preflight. Keep tests out of the repo tree so the firewall can't race them.

## 4. Fast phone testing without deploying
- Run the dev server on the LAN (`vite --host <PC LAN IP>`) and open it on the iPhone over Wi-Fi. Plain HTTP
  works thanks to the portable SHA-256. Service-worker/PWA checks still need HTTPS (deploy or a preview URL).
- Batch iPhone feedback into one message per test session.

## 5. Fewer waits on approvals
- Allowlist the safe repetitive commands (`npm run verify/health/preflight/browser`, `git status/diff/log`,
  `uv run ... x86dis`), e.g. with the `fewer-permission-prompts` skill, so the agent isn't blocked waiting
  on you. Keep deploys, installs, pushes and deletes as approvals.
- Give bundled briefs with a clear done-condition, then let the agent run.

## 6. Parallel work without collisions
- Independent pieces (asset pipeline, mobile shell, decompiler tooling) can run in **separate git worktrees
  and branches**, even Claude and Codex at the same time. Never two writers in one checkout.
- Read-only investigations (RE questions, asset census) go to cheap subagents in parallel.
- Merge often. Small branches merge cleanly.
