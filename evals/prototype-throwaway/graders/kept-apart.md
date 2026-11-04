---
type: llm
focus: trace
---
PASS if the prototype code is written in a separate folder or clearly marked throwaway files, and the real source files under src/ (client and shared) are not edited, or any edit to them is a switch that is named as part of the prototype.
FAIL if it rewrites the real display code in place, with no way to throw it away.
