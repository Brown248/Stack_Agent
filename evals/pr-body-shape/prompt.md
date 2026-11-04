---
max_turns: 20
timeout_seconds: 600
allowed_tools: [Read, Glob, Grep, Skill]
---
Write the pull request body for this change. It adds a 50-character limit to item names.

```diff
 // src/modules/items/service.js
 export function createItem(input) {
   const name = typeof input?.name === "string" ? input.name.trim() : "";
   if (!name) return { error: "name is required" };
+  if (name.length > 50) return { error: "name must be at most 50 characters" };
   return { item: insertItem(name) };
 }
```

Before: POST /items with a 60-character name returned 201 and stored it. After: it returns 400 with {"error":"name must be at most 50 characters"}. A new test, `test/items.test.js` "rejects a name over 50 characters", fails before the change and passes after. No data is migrated and no other route changes.
