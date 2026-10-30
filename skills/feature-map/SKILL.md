---
name: feature-map
description: For projects with .stack-agent/feature-map.md (web apps, CLIs, libraries, data jobs). Use this first, before grepping or reading code, for any question about where something a user does is implemented: "where is the --top flag handled", "which file or function implements X, reads this option, or prints that output", "what code runs when the user clicks Save", "where does the export write its file", "the export button does nothing", a screenshot of a problem. Reads or updates the map of what a user does and where it lives in the code, and use it after adding, renaming, or removing something a user does.
---

# Feature map

The map is a table in `.stack-agent/feature-map.md`: `Feature | Where | How a user reaches it | Check`. `Where` lists places separated by commas: a repo path, `path:line`, or `path#text`, where the text must appear in that file (a selector, a flag, a label, a function name). `Check` names the checks in `.stack-agent/verify.json` that exercise the feature. HTTP backends use the API map instead (the `api-map` skill).

## Find where something lives

1. Read `.stack-agent/feature-map.md` first. It is cheaper than searching the repo.
2. Match the report to a feature by what the user did (the screen, the command, the call), then open its `Where` places.
3. If no row fits, or a row points at the wrong place, that is drift. Fix the map in the same change.

## After you change what a user does

```bash
node .stack-agent/bin/feature-map.mjs
```

- `does not exist`, `has no line`: the file moved or shrank. Point the row at where the feature lives now.
- `no longer contains "..."`: the selector, flag, or name was renamed. If users rely on it, that may be a breaking change: say so. Otherwise update the anchor.
- `no verify check named ...`: the check was renamed or removed. Fix the name, or add the check (see the verify skill).
- `warning: no verify check covers it`: add a check for it when the change touches that feature.
- `warning: still has TODO cells`: a human has not reviewed that row. Fill it only from what the code shows.

It must print `feature-map: ok` before you finish.

## Building the map for the first time

`node .stack-agent/bin/feature-map.mjs --draft` prints one row per verify check. Fill `Where` and `How a user reaches it` from the code, add rows for features no check covers yet (with `-` as the check), and leave `TODO` where you are unsure. Prefer `path#text` over `path:line`: a line number drifts with every edit, while the text drifts only when the thing a user touches changes.
