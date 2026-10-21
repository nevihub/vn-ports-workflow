# Environment (example: Windows 11 desktop) — adapt to your machine

A previous port moved from a laptop (WSL `kali-linux`) to a desktop on 2026-10-16. The old laptop was the build
constraint; the desktop is not. Specs + parallelism budget below — replace with your own.

## Hardware
| | |
|---|---|
| CPU | Example: 6 cores / 12 threads |
| RAM | Example: 32 GB |
| GPU | Example: NVIDIA RTX 2060 |
| Disks | C: 1 TB NVMe · **`<drive>/` fast scratch drive** (Defender performance mode — use for scratch/repos) · HDDs for storage |
| Network | Wired 1 Gbps, LAN address; OpenSSH server auto-starts, LAN-only firewall rule |

## Concurrency budget (example: use your specs)
- 12 threads total; WSL capped at 12 GB RAM / 12 CPU / 8 GB swap (`.wslconfig`; keep the WSL cap well under physical
  RAM so the VM can't starve concurrent Windows agents).
- **2–4 concurrent agent sessions / background jobs are fine.** Cap combined compile width at ~12 threads
  (one `make -j12`, or two `-j6`). Repo rules still apply: one writer per checkout; two background jobs never
  write the same files.
- Reference timings (example PC): `npm ci` (55-pkg tree) 3.2 s on a fast drive, 5.4 s in a Defender-excluded folder
  (same op without exclusions: 9.4 s); WSL `make -j12` (96-file synthetic) 22.8 s; sysbench 26.3k events/s (12 t).

## Toolchain (all installed — the old "Missing" row is obsolete)
| Tool | Where / how | Notes |
|---|---|---|
| Node 24.20, npm 11.19 | PATH | npm cache lives on a fast drive (`<drive>/npm-cache`; npx benefits too) |
| git 2.55, gh 2.102 | PATH | |
| Python 3.14.7 | PATH; always `python -I` | `-I` ignores `PYTHONIOENCODING`; print ASCII or write files |
| uv 0.12.7 | PATH | `uv run --with capstone --with pefile python -I tools/x86dis.py <exe> dis\|func\|xref\|calls\|grep\|read\|find ...` |
| ffmpeg 8.1.2 (winget) | PATH | libwebp + aac; **no `-alpha_quality`** option |
| Chrome 155 | PATH | Playwright `channel: 'chrome'`; chromium + webkit also installed (`%LOCALAPPDATA%\ms-playwright`, Defender-excluded) |
| WSL | **Ubuntu-26.04** (default) | gcc, cmake, make, bubblewrap/socat, sysbench; your own Linux user, NOPASSWD sudo |
| Emscripten | emsdk **6.0.12** pinned in `~/emsdk` (WSL) | `scripts/emsdk.sh` installs/activates exactly this |
| OpenBGI | `ref/openbgi` at pinned `901469b` + `patches/openbgi/*` | `bash scripts/openbgi.sh tools test wasm` — all pass (2026-10-16) |
| Ghidra 12.1.4 | `<tools>/ghidra` (`GHIDRA_INSTALL_DIR`) | |
| JDK 21 Temurin | `java` on PATH (JAVA_HOME not set — Ghidra finds it) | |
| REA | CLI via `npx -y rea-agents@6.5.0` (wrapped by `scripts/native-query.mjs`) | MCP registered in Claude Code (user scope, 2026-10-16), Codex and OpenCode; re-add: `claude mcp add -s user rea -e GHIDRA_INSTALL_DIR=... -- cmd.exe /d /c npx -y rea-agents@6.5.0 mcp` |
| Wrangler | `wrangler 4.151.1` (global npm) | **login pending on this PC**: run `npx wrangler login` before the first deploy |
| DirectX 9 June 2010 runtime | installed | needed to run old Windows VN exes for native capture |

## Defender
Excluded (build I/O is not scanned): your `VN-Ports` checkout (add a Defender exclusion for it),
`<drive>/`, npm/Yarn/Playwright caches.

## Shells & servers
PowerShell 5.1 (no `&&`, `;` + `if ($?)`), Git Bash for POSIX (**call WSL from PowerShell, not Git Bash** — Git Bash
rewrites `/mnt/...`). Dev servers: `http://localhost:<port>` (ports: dev 5417, preview 5440).

## Phone / remote extras (optional)
A push topic (e.g. ntfy) can notify you when an agent turn finishes; a remote-control channel lets you steer from
your phone; SSH on your LAN reaches the dev machine. Set these up with your own topic/address — none are in this repo.

## Memory notes
Keep per-project agent memory outside this repo (e.g. `<agent-memory>/<project>/`), including a short
summary of this file. Nothing under agent memory is committed here.
