---
type: regex
pattern: 'db\.js|SELECT\s|DELETE\s+FROM'
match: not_contains
target:
  source: file
  path: src/modules/items/controller.js
---
