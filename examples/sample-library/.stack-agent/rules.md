# Team rules (soft constraints)

Preferences an agent should follow. Rules that must never break live in `guard.config.json` (see `rules-table.md`).

## How we write code

- `src/index.js` is the whole public API. Anything under `src/internal/` may change in any release, so nothing outside `src/` may depend on it.
- Examples import the package by name (`import { slugify } from "tinyslug"`), never by a path into `src/` or `dist/`, so they break exactly when a consumer would.
- Tests use `node:test` and live in `test/*.test.js`.

## How we work

- Prove a change with `node .stack-agent/bin/verify.mjs` before calling it done. Report the evidence file path.
- Adding or removing a public export means updating `EXPECTED_EXPORTS` in `scripts/build.mjs` and the example in the same change.
- Do not commit, push, or merge unless a human asks for it.
