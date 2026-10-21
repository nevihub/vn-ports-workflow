# Optional recipes (from agent-skills)

Three workflow recipes from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills), copied verbatim from commit `aeac41d4d005999432bb7312f7ff06383a91d59d` on 2026-10-16. License: MIT, see `LICENSE`.

| Recipe | Use when |
|---|---|
| `skills/debugging-and-error-recovery/` | Tests fail, a build breaks, or behaviour doesn't match expectations |
| `skills/test-driven-development/` | Adding logic, fixing a bug, or changing behaviour |
| `skills/doubt-driven-development/` | Before a non-trivial decision stands: a fresh-context review of your own claims |

`references/` holds the two files these recipes link to. The links resolve as copied.

## Not auto-enabled

Nothing here loads on its own. To use one in a project, copy `skills/<name>/` to `.claude/skills/<name>/`, and copy `references/` to `.claude/references/` so the links resolve.

## Overrides for this kit

These win over the recipe text.

- **Autonomy.** Decide with the standing defaults, record the choice in `docs/DECISIONS.md`, and don't ask the user at every step. The doubt-driven recipe requires offering a cross-model review in every interactive cycle. Skip that unless the user asks.
- **Cross-model review.** It sends the artifact to another vendor's CLI. Never send game content (decoded scripts, dialogue, extracted assets) that way.
- **Commands.** The test commands in the recipes are examples. Use the project's own, such as `npm run ...`.
- **Evidence.** Reverse-engineering claims use the labels PROVEN, STRONG and LEAD, not the recipe's generic rules.

The recipes also name other agent-skills skills (for example `browser-testing-with-devtools`) and the agent personas. Those aren't copied.
