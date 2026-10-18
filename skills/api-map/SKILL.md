---
name: api-map
description: Read or update the repo's API map (.stack-agent/api-map.md) that says which file handles each endpoint and what it calls. Use to find where an endpoint lives before changing it, when triaging a vague bug report ("POST /orders is slow", a screenshot of an error), and after adding, removing, or moving a route.
---

# API map

The map is a table in `.stack-agent/api-map.md`: `Method | Path | Handler | Calls | Owner`. `Handler` is a repo-relative file path. `Calls` is the chain the handler goes through (service, repository, table, outside API). `Owner` is the team or module.

## Find where something lives

1. Read `.stack-agent/api-map.md` first. It is cheaper than searching the whole repo.
2. Go straight to the Handler file, then follow the Calls chain.
3. If the map has no row for the endpoint, or the row is wrong, that is drift. Fix the map in the same change.

## After you change routes

```bash
node .stack-agent/bin/api-map.mjs
```

- `missing from map`: add a row.
- `stale in map`: the route is gone, remove the row.
- `bad handler path`: fix the path.
- `warning: no verify check covers`: add a check in `.stack-agent/verify.json` (see the verify-api skill).
- `warning: still has TODO cells`: a human has not reviewed that row. Fill it only from what the code shows.

The command must print `api-map: ok` before you finish.

## Building the map for the first time

`node .stack-agent/bin/api-map.mjs --draft` prints a table from the routes it finds. Replace the Handler column with the real handler file, fill Calls and Owner from the code, and leave `TODO` where you are unsure. A human reviews the TODO rows.
