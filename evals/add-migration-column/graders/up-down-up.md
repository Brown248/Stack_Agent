---
type: regex
target: trace
pattern: 'migrate: applied 0002_[\s\S]*migrate: rolled back 0002_[\s\S]*migrate: applied 0002_'
---
The runner's own output for the new migration, in order: applied, rolled back, applied again (three commands, or one `migrate.mjs redo`). Deleting the database to skip the down step prints no "rolled back". The source of migrate.mjs prints "${id}", never "0002_", so reading the runner cannot match. It replaced an llm grader that judged a long trace cut in the middle; on 2026-10-27 both agreed on 2 of 2 runs.
