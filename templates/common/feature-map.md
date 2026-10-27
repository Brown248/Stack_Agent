# Feature map

Where each thing a user does lives in the code, so an agent goes straight to it from a vague report ("the export button does nothing", a screenshot). `node .stack-agent/bin/feature-map.mjs` fails when the map and the code disagree.

- **Where**: one or more places, separated by commas: a repo path, `path:line`, or `path#text`, where text must appear in that file (a selector, a flag, a menu label, a function name). Use `#text` for anything that would break a user's path if it were renamed.
- **How a user reaches it**: the screen and the clicks, the command and its flags, or the call a consumer makes.
- **Check**: the names of the checks in `.stack-agent/verify.json` that exercise it, separated by commas, or `-`.

Start from `node .stack-agent/bin/feature-map.mjs --draft` (one row per verify check), replace the placeholder row below, and leave `TODO` where a human should look.

| Feature | Where | How a user reaches it | Check |
| --- | --- | --- | --- |
| EDIT ME: what the user does | EDIT ME: path, path:line, or path#text | EDIT ME: the steps or the command | EDIT ME: verify check name, or - |
