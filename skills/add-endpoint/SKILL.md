---
name: add-endpoint
description: For HTTP backends (backend-http preset). Add a new HTTP endpoint the way this repo does it, with a test, a verify check, a guard-clean layout, and an updated API map. Use for "add an endpoint", "เพิ่ม endpoint", "new route", "new API".
---

# Add an endpoint

## 1. Settle the contract before code

Write down, in your reply: method and path, request body or query shape, the success status and response shape, and each error case with its status. If the user did not say, pick the convention the nearest existing endpoint uses and state it.

## 2. Copy the nearest example, not your habit

Read `.stack-agent/api-map.md` and pick the closest existing endpoint in the same module. Open its handler and the chain in its Calls column. Put each piece of the new endpoint in the same layer as the example: routing where routes are declared, request parsing in the controller, business rules in the service, data access in the repository. Read `.stack-agent/rules.md` for team preferences.

## 3. Test first

Add a test next to the existing tests for that module. It must fail before your implementation exists. Cover the success case and at least one error case. Assert what a client observes (status and body), not internal calls.

## 4. Implement, then check structure

Write the smallest code that makes the test pass. Then run:

```bash
node .stack-agent/bin/guard.mjs
```

It must print `guard: ok`. If it names a rule, follow its `fix` line. Never raise the baseline to get past it.

## 5. Prove it on the running API

Add checks for the new endpoint to `.stack-agent/verify.json` (success and one rejection), then follow the verify skill. The full `node .stack-agent/bin/verify.mjs` must print `verify: ok`.

## 6. Update the map

Add the row to `.stack-agent/api-map.md`. `node .stack-agent/bin/api-map.mjs` must print `api-map: ok`.

## Report

The contract, the files you changed, the test name, and the three check outputs (guard, verify with its evidence path, api-map). Do not commit unless the user asks.
