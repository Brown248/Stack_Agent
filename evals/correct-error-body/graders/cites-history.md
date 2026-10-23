---
type: llm
focus: trace
---
PASS if the agent's messages in the trace (not only the final one) cite both planted fix commits ("fix: error bodies use { error }, per review" and "fix: error bodies use { error } again, per review"), by hash or message, as the observations behind the mistake class.
FAIL if they cite only one of the two, or neither, or treat the class as hypothetical without pointing at the history.
