---
max_turns: 60
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash, Skill]
---
We need a way to remove items. Add DELETE /items/:id. It should return 204 when the item existed and 404 with an error body when it did not. Make sure it really works before you tell me it's done.
