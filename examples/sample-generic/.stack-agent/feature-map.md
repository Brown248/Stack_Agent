# Feature map

What a user of the expense-totals job does, and where it lives. Checked by `node .stack-agent/bin/feature-map.mjs` (see `templates/common/feature-map.md` for the format).

| Feature | Where | How a user reaches it | Check |
| --- | --- | --- | --- |
| Total expenses per category | job.mjs, src/transform.js#export function totalsByCategory | `node job.mjs INPUT_CSV OUTPUT_CSV` | smoke |
| Read an expenses CSV | src/transform.js#export function parseCsv | the INPUT_CSV argument (date,category,amount) | smoke |
| Write the totals CSV | src/transform.js#export function toCsv, job.mjs#writeFileSync | the OUTPUT_CSV argument | smoke |
