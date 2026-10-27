# Rule table

| Rule | Why | Enforced by | Proof it catches a real mistake |
| --- | --- | --- | --- |
| No SQL in controllers | queries in controllers skip the repository and its tests | guard `no-sql-in-controller` | `tests/guard.test.mjs` "pattern rule flags SQL in a controller" |
| Only repositories import `src/db.js` | keeps data access in one layer | guard `controller-no-db` | `tests/guard.test.mjs` "forbidden-import flags a controller importing db" |
| Modules talk only through `index.js` | lets a module change its internals safely | guard `module-boundary` (baseline holds the legacy `reports` case) | `src/modules/reports/controller.js:1`, recorded in `guard-baseline.json` |
| Prove changes on the running API | "it compiles" is not "it works" | Stop hook `stop-verify.mjs` reminder + `verify` skill | `tests/hooks.test.mjs` "stop hook blocks once when code changed without evidence" |
