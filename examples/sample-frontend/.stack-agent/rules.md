# Team rules (soft constraints)

Preferences an agent should follow. Rules that must never break live in `guard.config.json` (see `rules-table.md`).

## How we write code

- `src/client/` is browser code, `src/server/` is the Node dev server, and `src/shared/` is plain JavaScript both sides may import (no DOM, no `node:` modules).
- The page loads only ES modules, and everything it imports must be served under `/` (client) or `/shared/`.
- Tests use `node:test` and live in `test/*.test.js`. Page-level behavior is checked by `scripts/e2e.mjs` against the running server.

## How we work

- Prove a change with `node .stack-agent/bin/verify.mjs` before calling it done. It starts the dev server, checks the page, and runs the e2e script. Report the evidence file path.
- Do not commit, push, or merge unless a human asks for it.
