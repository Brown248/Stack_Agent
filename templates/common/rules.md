# Team rules (soft constraints)

These are preferences an agent should follow but nothing fails when it skips them.
A rule that must never break does not belong here. Move it to `guard.config.json` (see `rules-table.md`).

## How we write code

- EDIT ME: one preference per line, with the reason, e.g. "Prefer early returns over nested if, it keeps handlers flat."

## How we work

- Prove a change with `node .stack-agent/bin/verify.mjs` before calling it done. Report the evidence file path.
- If the project has `.stack-agent/api-map.json`, keep `.stack-agent/api-map.md` in sync with the routes. `node .stack-agent/bin/api-map.mjs` fails when it drifts.
- Do not commit, push, or merge unless a human asks for it.
