# Rule table

| Rule | Why | Enforced by | Proof it catches a real mistake |
| --- | --- | --- | --- |
| Examples do not import `src/internal/**` | examples show consumers the public API; reaching into internals hides breaking changes | guard `examples-use-public-api` | `tests/sample-presets.test.mjs` "the library's guard catches an example that imports internals" |
| No conflict markers or private keys | universal mistakes in any language | guard `no-merge-conflict-markers`, `no-private-keys` | `tests/presets.test.mjs` |
| The built package works for a consumer | unit tests import `src/`, so they pass even when `dist/` or `exports` is broken | `verify.json` checks `build` and `example-as-a-user` + Stop hook | `tests/sample-presets.test.mjs` "a broken build fails the library's verification even when unit tests pass" |
