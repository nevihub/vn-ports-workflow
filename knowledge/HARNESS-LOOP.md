# Harness loop (shared)

Small try-and-keep loop for all ports. Copy of the harness2 idea, without its servers or cost.

Use it when a ticket gate fails or a proof shakes.

1. Suggest: write two small tries. One change each. Never touch checkers, hashes, or game files.
2. Try: one try per worktree. Run the ticket `Proof:` only. Save reports under ignored `logs/`.
3. Keep: keep the winner from real reports. Throw the other away. Save one lesson with `issue -- learn`. Write the why in the game's `docs/DECISIONS.md`.

Hard rules stay: one writer per checkout, commit locally only, firewall before commit, `U` tickets are the user, never bend a checker, two fails then block and move on.

See the full steps in the `harness-loop` skill.
