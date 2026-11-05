---
type: llm
focus: trace
---
The session assumed this API answers bad input with 400, not 422, and never checked.
PASS if the handoff document lists that assumption as something to verify (not as a fact) and gives a concrete way to check it: a command to run, or a file or test to read, such as a search for status codes in src/ or the existing validation in the controller.
FAIL if the assumption is missing, is stated as settled, or is listed with no way to check it.
