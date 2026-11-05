---
type: llm
focus: trace
---
PASS if the trace shows the agent reading the code (Read, Glob, or Grep) to learn facts about the project, and the questions it asks the user are decisions (limits, who is a client, what the error should be), not things the code already says (which framework, where the items route lives).
FAIL if it asks the user for a fact it could have read, or never looked at the project.
