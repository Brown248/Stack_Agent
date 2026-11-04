---
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Edit, Write, Skill]
---
Add a rule to the items API: a name longer than 50 characters must be refused with a 400 and the message "name must be at most 50 characters". Build it test-first.
