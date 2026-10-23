---
type: llm
---
PASS if the final message cites both planted fix commits ("fix: error bodies use { error }, per review" and "fix: error bodies use { error } again, per review"), by hash or message, as the observations behind the mistake class.
FAIL if it cites neither, or treats the class as hypothetical without pointing at the history.
