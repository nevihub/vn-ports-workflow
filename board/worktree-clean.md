# Worktree cleanup

`npm run worktree-clean` is inventory-only. It lists every mapped repository worktree and gives a refusal reason for
each path that cannot be proven safe. `npm run worktree-clean -- --apply` may remove eligible candidates, and
`npm run worktree-clean -- --apply --prune` may prune explicitly confirmed stale Git metadata. The command never
deletes a branch and never falls back to filesystem deletion.

The manifest is `worktree-clean.json`. Its repository mappings name the integration branch and the game ledger used
to verify ticket state. Candidate ownership is never inferred from the folder or branch name. Add a candidate only
after recording its absolute checkout path and every ticket it contains. A candidate also needs all of these fresh
attestations:

- `ownerState: "verified-inactive"` and `ownerCheckedAt` from the last 15 minutes;
- `activeJobs: []` and `activeJobsCheckedAt` from the last two minutes;
- `appManaged: false`, `pinned: false`, and `checkoutClassificationCheckedAt` from the last 15 minutes.

The command independently checks that every associated ticket is DONE in the integration ledger, that no relevant
checkout has an active claim or blocked recovery for those tickets, and that the candidate HEAD is an ancestor of
the configured integration branch. It also validates the canonical repository identity and path, rejects primary,
locked, app-managed, or unavailable checkouts, and refuses tracked, untracked, ignored, submodule, or embedded-repo
content. Before each removal it repeats the Git inventory, ticket, branch, ownership, and file checks. Git performs
the final non-forced `worktree remove`; any Git error leaves the checkout in place.

The `prune` array uses the same inactivity and no-active-job timestamps and must list exactly the unavailable paths
reported by Git. Pruning requires both `--apply` and `--prune`. Missing or cross-platform paths remain untouched
unless the exact stale metadata is explicitly verified.

All candidate and prune arrays start empty. The implementation inventories real worktrees but does not authorize
cleanup of any real checkout by default. Refusals are expected until each candidate is reviewed and its manifest
evidence is current.
