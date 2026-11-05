---
type: llm
focus: trace
---
PASS if the final message asks several questions in one round, numbered, and gives a recommended answer for each, worded so that a plain yes accepts it.
FAIL if it asks one question at a time, asks questions with no recommendation, or starts to design or write the feature instead of asking.
