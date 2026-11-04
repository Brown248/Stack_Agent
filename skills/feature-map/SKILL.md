---
name: feature-map
description: For projects with .stack-agent/feature-map.md (web apps, CLIs, libraries, data jobs). Use this first, before grepping or reading code, for any question about where something a user does is implemented: "where is the --top flag handled", "which file or function implements X, reads this option, or prints that output", "what code runs when the user clicks Save", "where does the export write its file", "the export button does nothing", a screenshot of a problem, "ฟีเจอร์นี้อยู่ไฟล์ไหน", "ปุ่มนี้ไม่ทำงาน". Reads or updates the map of what a user does and where it lives in the code, lists the cases of a feature, and repairs the map after a refactor; use it after adding, renaming, moving, or removing something a user does.
---

# Feature map

The map is a table in `.stack-agent/feature-map.md`: `Feature | Where | How a user reaches it | Check`. `Where` lists places separated by commas: a repo path, `path:line`, or `path#text`, where the text must appear in that file (a selector, a flag, a label, a function name). `Check` names the checks in `.stack-agent/verify.json` that exercise the feature. A feature that has more than a normal path can have a section under the table, `### Cases: <feature name>`, with a table `Case | Expected | Check`. HTTP backends use the API map instead (the `api-map` skill).

## Find where something lives

1. Read `.stack-agent/feature-map.md` first. It is cheaper than searching the repo.
2. Match the report to a feature by what the user did (the screen, the command, the call), then open its `Where` places.
3. If no row fits, or a row points at the wrong place, that is drift. Fix the map in the same change.

## After you change what a user does

```bash
node .stack-agent/bin/feature-map.mjs
```

- `does not exist`, `has no line`: the file moved or shrank. Point the row at where the feature lives now.
- `differs from the real file name in letter case`: the path works on Windows and macOS and fails on Linux CI. Write it exactly as the file is named.
- `no longer contains "..."`: the selector, flag, or name was renamed. If users rely on it, that may be a breaking change: say so. Otherwise update the anchor.
- `no verify check named ...`: the check was renamed or removed. Fix the name, or add the check (see the verify skill).
- `warning: no verify check covers it` or `... covers this case`: add a check for it when the change touches that feature.
- `warning: verify check ... is in no row or case`: a check exists that the map does not mention. Add it to the feature it exercises.
- `warning: still has TODO cells`: a human has not reviewed that row. Fill it only from what the code shows.

It must print `feature-map: ok` before you finish. Add a new feature as a row in the main table, above any `Cases:` section: a row added at the end of the file would be read as a case.

## List the cases of a feature

Do this for the main features when you build the map, and for a feature you are changing. A case is something a user can do to the feature that gives a different result. Read the code and the spec, and look for:

- the normal path;
- each way the code refuses or fails (a bad input, a missing file, no permission), one case each;
- the limits: the smallest and largest value, an empty input, one more than the limit;
- doing it twice, or after it has already been done;
- the first time versus when something already exists;
- who may do it, and who may not.

Write one row per case: a short name, the result a user can observe (a message, a status, an exit code, what appears), and the verify check that proves it, or `-` when none does yet. Use `TODO` where you are unsure. Never write a case the code does not show. A case that has no check is useful on its own: the tool lists it as a warning, so the gap is visible.

## Repair the map after a big change

After a refactor, a rename, or a move, many rows can break at once. Do not edit them blind.

1. Run `node .stack-agent/bin/feature-map.mjs --suggest`. It lists the problems and, under each, where a moved file or anchor went and the closest check name. It changes nothing.
2. Fix the mechanical ones the suggestion and the code agree on: a moved file, a renamed anchor, a renamed check. Open the new place and confirm the feature is there before you write it into the row.
3. For a feature whose code is gone, or whose behavior changed, do not guess. Keep the row, mark the cells `TODO`, and list it in your report so a human decides whether to remove it.
4. Add rows for features the change introduced, and cases for the ways they are refused.
5. Run the check again until it prints `feature-map: ok`, then read the warnings it still prints.

Say in the report what you changed, what you left as `TODO` and why, and what the check still warns about. Do not commit.

## Building the map for the first time

`node .stack-agent/bin/feature-map.mjs --draft` prints one row per verify check. Fill `Where` and `How a user reaches it` from the code, add rows for features no check covers yet (with `-` as the check), and leave `TODO` where you are unsure. Prefer `path#text` over `path:line`: a line number drifts with every edit, while the text drifts only when the thing a user touches changes. A place cannot contain a comma, because commas separate places; write a pipe inside a cell as `\|`.
