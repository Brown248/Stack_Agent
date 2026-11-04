---
type: llm
focus: trace
---
PASS if a test file is created or edited before any file under src/ is edited, or if the agent stops to ask the user to confirm the seams and edits no file under src/ at all.
FAIL if a file under src/ is edited before any test is written.
