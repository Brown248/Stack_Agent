---
type: llm
focus: trace
---
PASS if, before the first edit or write of any file under src/, the trace shows the agent saying which public interface or seam it will test (for example POST /items, or the function that creates an item), whether it then asks the user to confirm it or goes on.
FAIL if a file under src/ is edited before any seam is named.
