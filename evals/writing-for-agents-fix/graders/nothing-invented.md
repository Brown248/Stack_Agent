---
type: llm
focus: trace
---
The deploy skill's steps are: run the tests, build the image, push the image, update the manifest, watch the rollout, and roll back if the rollout fails.
PASS if the fixed skill keeps those steps and the rollback rule, is shorter or less repetitive than before, and the agent says what it changed.
FAIL if it adds deploy steps or commands that were not in the original, drops a step or the rollback rule, or edits files other than the skill.
