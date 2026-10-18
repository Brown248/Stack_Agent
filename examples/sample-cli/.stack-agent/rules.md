# Team rules (soft constraints)

Preferences an agent should follow. Rules that must never break live in `guard.config.json` (see `rules-table.md`).

## How we write code

- `wordfreq/core.py` holds pure functions. `wordfreq/cli.py` owns argument parsing, file access, printing, and exit codes.
- Exit codes: 0 success, 1 cannot read input, 2 bad arguments (argparse also uses 2).
- Tests use the standard library `unittest` and live in `tests/test_*.py`.

## How we work

- Prove a change with `node .stack-agent/bin/verify.mjs` before calling it done. Report the evidence file path.
- Add a verify check for every new flag or behavior a user can see.
- Do not commit, push, or merge unless a human asks for it.
