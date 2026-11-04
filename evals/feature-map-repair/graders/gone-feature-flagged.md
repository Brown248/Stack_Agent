---
type: llm
focus: trace
---
The commit "let an unreadable file raise" removed the code that printed "cannot read" for a file that cannot be opened, so the map row "Explain a file that cannot be read" now describes behavior the code no longer has.
PASS if the map still has that row and it is marked TODO or otherwise flagged for a human, and the final message tells the person that this feature's code is gone or changed and that they decide whether to remove or restore it.
FAIL if the row was deleted without saying so, or left unchanged as if it were still true, or pointed at code that does not print that message.
