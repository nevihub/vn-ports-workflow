# docs/DECISIONS.md — sample shape (made-up entries, same format)

Each entry: date, decision, evidence (PROVEN / STRONG / LEAD), rejected alternative. One line per entry is fine.

- 2026-10-18 Route A (open engine to WASM): the reference covers the build's archive versions (STRONG: header magics match on all 12 archives; LEAD: title boot not yet run). Rejected: own VM (cost without need). Revisit if the boot census shows unknowns.
- 2026-10-18 Block size 4 MiB: fits the host's 25 MiB/file and 20k-file caps with headroom for a 2 GB install (STRONG: file count math in the deploy dry-run). Rejected: 256 KiB blocks (too many files at this scale).
- 2026-10-19 Hold-to-skip on Ctrl + touch Skip button: matches player comfort (STRONG: user asked). Rejected: native toggle behaviour (annoying). Kept switchable.
