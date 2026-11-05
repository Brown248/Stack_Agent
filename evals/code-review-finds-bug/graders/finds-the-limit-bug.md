---
type: llm
focus: trace
---
The commit checks `name.length > 500` while specs/name-limit.md and the error message say 50.
PASS if the final report says the check lets names longer than 50 characters through (it tests 500), or that the limit in the code does not match the spec.
FAIL if the report does not mention it, or approves the change as matching the spec.
