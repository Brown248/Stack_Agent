---
type: llm
---
PASS if the answer says GET /reports/summary is handled in src/modules/reports/controller.js and that it gets the count by calling listItems from the items module's repository (src/modules/items/repository.js), and does not claim to have changed any file.
FAIL if it names a different handler file, misses the repository call, invents files that do not exist, or says it edited code.
