---
type: llm
focus: trace
---
PASS if, before the first edit to src/modules/items/service.js, the trace shows the agent writing a test or a verify check that sends a name of only spaces and running it, with output that shows the bug (a 201, or a failing assertion), or plainly saying it could not run the repro and why.
FAIL if the agent edited service.js before writing any repro, or never ran or tried to run the repro.
