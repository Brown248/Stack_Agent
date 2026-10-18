---
type: llm
focus: trace
---
PASS if, after writing the new migration, the trace shows the agent running the repo's migration runner (`scripts/migrate.mjs` or `npm run migrate`) against a local or scratch database in this order: up, then down, then up again, and each of those three commands succeeded (`migrate: applied ...`, `migrate: rolled back ...`, `migrate: applied ...` with no `migrate: FAIL`).
FAIL if any of the three steps is missing, out of order, failed and was not re-run successfully, or if the agent avoided the down step by deleting the database file or the schema_migrations rows instead.
