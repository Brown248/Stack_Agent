# Team rules (soft constraints)

Preferences an agent should follow. Nothing fails when it skips them. Rules that must never break live in `guard.config.json` (see `rules-table.md`).

## How we write code

- Each module lives in `src/modules/<name>/` with `controller.js` (HTTP in and out), `service.js` (rules and validation), `repository.js` (data access), and `index.js` (what other modules may use).
- Controllers return `res.json(status, body)`. Errors use `{ "error": "<message>" }` with a 4xx status.
- Register every route in `src/routes.js` with `route("METHOD", "/path", handler)`, so the API map can find it.
- Tests live in `test/<module>.test.js`, start the app on port 0, and assert status and body.

## How we work

- Prove a change with `node .stack-agent/bin/verify.mjs` before calling it done. Report the evidence file path.
- Keep `.stack-agent/api-map.md` in sync with `src/routes.js`.
- Do not commit, push, or merge unless a human asks for it.
