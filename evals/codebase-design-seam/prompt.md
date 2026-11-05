---
max_turns: 25
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---
In the items module, service.js mostly forwards to repository.js, and the controller just forwards to the service. It feels shallow. Where should the seam go, and what would a deeper interface look like? Don't change any code.
