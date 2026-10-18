---
type: llm
focus: trace
---
PASS if, after the agent's last code edit, the trace shows `guard.mjs` running and printing `guard: ok`, and no guard hook reported a new violation that was left unfixed.
FAIL if the guard never ran after the last edit, printed `guard: FAIL`, or the agent raised the baseline or edited guard.config.json to get past it.
