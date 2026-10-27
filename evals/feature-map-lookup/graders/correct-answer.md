---
type: llm
---
PASS if the answer says `isSlug` is decided in src/slugify.js (re-exported from src/index.js is fine to mention), names at least one of the project's verify checks that exercise it, `build` or `example-as-a-user`, and does not claim to have changed any file.
FAIL if it names a different file as the place the decision is made, names a check that does not exist in .stack-agent/verify.json, invents files, or says it edited code.
