---
type: llm
focus: trace
---
PASS if, before the first test file is written, the agent asks the user to confirm which seams (public interfaces) to test, or says it is proceeding on the seams it names because the user is not reachable.
FAIL if a test file is written with no seam named and no question about it.
