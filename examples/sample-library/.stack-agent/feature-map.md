# Feature map

What a consumer of the tinyslug package does, and where it lives. Checked by `node .stack-agent/bin/feature-map.mjs` (see `templates/common/feature-map.md` for the format).

| Feature | Where | How a user reaches it | Check |
| --- | --- | --- | --- |
| Turn a title into a slug | src/slugify.js#export function slugify, src/index.js#slugify | `import { slugify } from "tinyslug"` | build, example-as-a-user |
| Check whether text is a slug | src/slugify.js#export function isSlug, src/index.js#isSlug | `import { isSlug } from "tinyslug"` | build, example-as-a-user |
| Use the built package | package.json#"./dist/index.js", scripts/build.mjs | `npm run build`, then import "tinyslug" | build |
