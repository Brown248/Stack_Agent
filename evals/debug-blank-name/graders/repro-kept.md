---
type: llm
focus: trace
---
PASS if, at the end, a test under test/ or a check in .stack-agent/verify.json sends a name of only spaces to POST /items and expects 400.
FAIL if no such test or check is left in the project.
