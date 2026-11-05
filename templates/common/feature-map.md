# Feature map

Where each thing a user does lives in the code, so an agent goes straight to it from a vague report ("the export button does nothing", a screenshot). `node .stack-agent/bin/feature-map.mjs` fails when the map and the code disagree.

- **Where**: one or more places, separated by commas: a repo path, `path:line`, or `path#text`, where text must appear in that file (a selector, a flag, a menu label, a function name). Use `#text` for anything that would break a user's path if it were renamed.
- **How a user reaches it**: the screen and the clicks, the command and its flags, or the call a consumer makes.
- **Check**: the names of the checks in `.stack-agent/verify.json` that exercise it, separated by commas, or `-`.

Start from `node .stack-agent/bin/feature-map.mjs --draft` (one row per verify check), replace the placeholder row below, and leave `TODO` where a human should look.

**Cases (optional).** A feature is more than its normal path. Under the table, a feature that has other cases worth naming gets a section like the one below (copy it out of the fence). `-` in the Check column says no check covers that case yet: the tool warns, it does not fail. Put new features in the main table above the sections, not at the end of the file. A pipe inside a cell is written `\|`.

```markdown
### Cases: <exact name of the feature in the table>

| Case | Expected | Check |
| --- | --- | --- |
| the normal path | what the user sees | check-name |
| an input the code refuses | the error and the status | - |
```

After a big change, `node .stack-agent/bin/feature-map.mjs --suggest` says where a moved file or anchor went.

| Feature | Where | How a user reaches it | Check |
| --- | --- | --- | --- |
| EDIT ME: what the user does | EDIT ME: path, path:line, or path#text | EDIT ME: the steps or the command | EDIT ME: verify check name, or - |
