---
type: llm
---
PASS if the proposal routes the repeated SQL-in-controller correction to a check that fails loudly (a guard rule, or handing it to /stack-agent:correct), or notes that the guard already has such a rule and asks why it did not stop the mistake.
FAIL if the only proposed home for that correction is a sentence in rules.md, CLAUDE.md, or a skill.
