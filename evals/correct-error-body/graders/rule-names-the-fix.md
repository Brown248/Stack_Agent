---
type: llm
---
PASS if the agent adds or proposes (for a human to approve, since editing guard.config.json asks one) a guard rule, or a higher-level check, that fails on an error body built with message in a controller's res.json call, and whose fix text says to use { error }.
FAIL if it only edits rules.md or other docs, or proposes a rule whose pattern would not match the planted mistake, or whose fix does not name the { error } shape.
