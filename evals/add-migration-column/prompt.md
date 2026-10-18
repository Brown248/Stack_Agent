---
max_turns: 60
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash, Skill]
---
Items need a price. POST /items should accept an optional `price` (a whole number of cents, 0 or more, default 0) and reject anything else with a 400, and GET /items should return each item's price. Store it in the database properly. Make sure it really works before you tell me it's done.
