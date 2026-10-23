---
type: llm
focus: trace
---
PASS if the trace shows the new check failing on the mistake (the guard with --strict on a copy or fixture of the bad controller, or a test), or the final message says plainly that it could not prove the check fires and why.
FAIL if the final message claims the rule is proven without a run in the trace that shows it firing.
