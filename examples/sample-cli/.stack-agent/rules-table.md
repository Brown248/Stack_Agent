# Rule table

| Rule | Why | Enforced by | Proof it catches a real mistake |
| --- | --- | --- | --- |
| `core.py` does no I/O | keeps the counting logic testable without files or a terminal | guard `core-is-pure` | `tests/sample-cli.test.mjs` "the Python CLI's guard catches I/O in core.py" |
| No conflict markers or private keys | universal mistakes in any language | guard `no-merge-conflict-markers`, `no-private-keys` | `tests/presets.test.mjs` |
| Prove changes on the real CLI | "the tests pass" is not "the command works" | `verify.json` command checks + Stop hook | `tests/sample-cli.test.mjs` "the Python CLI passes its own full verification" |
