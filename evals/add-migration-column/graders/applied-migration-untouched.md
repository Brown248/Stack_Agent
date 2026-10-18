---
type: regex
pattern: 'price'
flags: i
match: not_contains
target:
  source: file
  path: migrations/0001_create_items.up.sql
---
