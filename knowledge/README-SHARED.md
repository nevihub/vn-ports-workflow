# VN-Ports knowledge (shared by every port and every agent)

| File | Read it when |
|---|---|
| `DEFAULTS.md` | before asking the user anything - the standing decisions and the short "still ask" list |
| `PLAYBOOK.md` | starting or resuming a port - the stages S0-S7 and their exit gates |
| `RE-PORT-PLAYBOOK.md` | reverse-engineering a game binary and its archives before the port - first-hour checklist, fingerprint, formats, decoders, engine route; BGI/Ethornell module; tools inventory (checked by `npm run proof:playbook` in Subahibi) |
| `LESSONS.md` | before a non-trivial problem - process rules, engineering lessons, failure museum, and the **lesson log** agents append to (`npm run issue -- learn`) |
| `ENGINES.md` | touching engine work - Saya (N2System), Subahibi (BGI), Sakura (Artemis) side by side, what transfers |
| `SAYA-RECIPE.md` | building hosting, saves, audio, mobile or proof tooling - how Saya did it, file by file |
| `TEMPLATES.md` + `templates/` | setting up a new repo - files to copy and what to rename |
| `ENVIRONMENT.md` | running tools - this PC, toolchain, concurrency budget, shells |
| `USAGE-TIPS.md`, `SPEED-TIPS.md` | keeping sessions cheap and fast |
| `AA-model-ranking.md` | picking models or budgets - which artificialanalysis.ai benchmarks map to port work, weighted ranking, refresh snippet |
| `CYBER-model-ranking.md` | security-shaped tickets - Vals CyberBench v1.1 (PoC/Patch) scores for the same models, picks by cyber job, and the red/blue-team data gap; not a red/blue scoreboard |
| `AA-model-charts.html` | the visual version - scatter charts (quality vs cost/speed), OpenCode Go buckets, benchmark matrix, vendor panel, CyberBench section; open in a browser |
| `NEW-PC-SETUP.md` | rebuilding this setup on another PC |

Search all of it plus every game's decisions and handoff: `npm run kb -- "<words>"` in `VN-Ports\board`.
This folder is git-tracked by the VN-Ports root repo (the games and the board keep their own repos). It never holds
game content or story text. Moved here from `subahibi-port-kit\docs` on 2026-10-18; that kit keeps only the
Subahibi-specific plan and research.
