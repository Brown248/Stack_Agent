---
max_turns: 30
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---
My plan: add rate limiting to the items API so one client cannot create more than 20 items a minute. I'd keep a counter per client in memory and return an error when it goes over. Grill me on this plan before I build it.
