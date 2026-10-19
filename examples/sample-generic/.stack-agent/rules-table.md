# Rule table

| Rule | Why | Enforced by | Proof it catches a real mistake |
| --- | --- | --- | --- |
| `src/transform.js` does no I/O | keeps the transform testable without files, and keeps one place that touches disk | guard `transform-is-pure` | `tests/sample-presets.test.mjs` "the data job's guard catches I/O in the transform" |
| No conflict markers or private keys | universal mistakes in any language | guard `no-merge-conflict-markers`, `no-private-keys` | `tests/presets.test.mjs` |
| Prove changes on the real job and data | "the tests pass" is not "the job produces the right file" | `verify.json` check `smoke` + Stop hook | `tests/sample-presets.test.mjs` "a miscounted summary fails the data job's verification" |
