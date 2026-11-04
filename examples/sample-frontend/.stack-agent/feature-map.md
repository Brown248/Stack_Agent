# Feature map

What a user of the tip splitter does, and where it lives. Checked by `node .stack-agent/bin/feature-map.mjs` (see `templates/common/feature-map.md` for the format).

| Feature | Where | How a user reaches it | Check |
| --- | --- | --- | --- |
| Split a bill with a tip | src/client/index.html#<form id="split">, src/client/app.js#splitBill, src/shared/format.js#export function splitBill | open / and type the total, tip %, and people | home-page, e2e |
| See each person's share | src/client/index.html#<output id="share" | the "Each person pays" line under the form | e2e |

### Cases: Split a bill with a tip

| Case | Expected | Check |
| --- | --- | --- |
| open the page | the home page loads with the form | home-page |
| fill the form and submit | the share appears in the "Each person pays" line | e2e |
| fewer than one person, or a negative total | a `RangeError` from `splitBill` (covered by the unit tests, not by a verify check) | - |
