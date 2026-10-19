# Team rules (soft constraints)

Preferences an agent should follow. Rules that must never break live in `guard.config.json` (see `rules-table.md`).

## How we write code

- `src/transform.js` holds pure functions (text in, values or text out). `job.mjs` owns reading the input, writing the output, printing, and exit codes.
- Money is summed in integer cents, never in floating-point dollars.
- Tests use `node:test` and live in `test/*.test.js`.

## How we work

- Prove a change with `node .stack-agent/bin/verify.mjs` before calling it done. It runs the real job on `data/expenses.csv`. Report the evidence file path.
- Do not commit, push, or merge unless a human asks for it.
