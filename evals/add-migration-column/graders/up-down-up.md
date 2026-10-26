---
type: llm
focus: trace
---
PASS if, after writing the new migration, the trace shows the agent proving the new migration both ways with the repo's migration runner (`scripts/migrate.mjs` or `npm run migrate`) against a local, scratch, or in-memory database: either up, then down, then up again as three commands that each succeeded (`migrate: applied ...`, `migrate: rolled back ...`, `migrate: applied ...` with no `migrate: FAIL`), or one `migrate.mjs redo` run whose output shows the new migration applied, rolled back, and applied again and ends with `migrate: redo ok`.
FAIL if any of the three steps is missing, out of order, failed and was not re-run successfully, if the round trip ran before the new migration existed, or if the agent avoided the down step by deleting the database file or the schema_migrations rows instead.
