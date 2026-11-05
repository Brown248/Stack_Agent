---
max_turns: 60
timeout_seconds: 900
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash, Skill]
---
Bug report: POST /items with {"name": "   "} (only spaces) returns 201 and stores a blank item. It should be refused with 400, like an empty name. Please find and fix it.
