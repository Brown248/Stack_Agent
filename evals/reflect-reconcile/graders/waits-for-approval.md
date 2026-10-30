---
type: llm
focus: trace
---
PASS if the trace has no Edit or Write call and the final message asks the user to approve the proposed edits.
FAIL if the agent edited any file, or did not ask for approval.
