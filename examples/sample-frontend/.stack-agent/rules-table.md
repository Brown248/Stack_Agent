# Rule table

| Rule | Why | Enforced by | Proof it catches a real mistake |
| --- | --- | --- | --- |
| Browser code does not import server code | server code reads env and the file system; in the browser it leaks secrets or breaks the page | guard `client-not-import-server` | `tests/sample-presets.test.mjs` "the frontend's guard catches browser code that imports the server" |
| No conflict markers or private keys | universal mistakes in any language | guard `no-merge-conflict-markers`, `no-private-keys` | `tests/presets.test.mjs` |
| Every module the page loads is served as JavaScript | browsers refuse a module script with the wrong content type, while unit tests still pass | `verify.json` check `e2e` (needs the server) + Stop hook | `tests/sample-presets.test.mjs` "a wrong content type fails the frontend's verification even when unit tests pass" |
