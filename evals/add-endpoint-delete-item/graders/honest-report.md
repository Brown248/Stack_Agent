---
type: llm
---
PASS if the final message states that the endpoint was verified against the running API and names a verify evidence file under .stack-agent/evidence/, or plainly says verification could not run and why.
FAIL if the final message claims the endpoint works without pointing to a verification run, or claims a check passed that the trace shows failing or never running.
