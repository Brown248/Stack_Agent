---
max_turns: 40
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Edit, Write, Bash, Skill]
---
Item names longer than 50 characters are breaking our reports. Make POST /items reject them with a 400.
