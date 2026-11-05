---
type: llm
focus: trace
---
PASS if, before the first edit to any file under src/, the trace shows the agent running one command (a test, a script, or a request against a running server) that sends a name of only spaces, and the output shows the bug (201, or a failing assertion), or plainly saying it could not build one and why.
FAIL if a file under src/ is edited before such a command ran, or if the agent only read code and theorised before running anything.
