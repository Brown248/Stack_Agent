---
name: stack-agent-init
description: Set up Stack Agent in the current backend repo (verification config, guard rules with a baseline, API map, team rules, CI workflow). Use for /stack-agent-init or "ติดตั้ง stack agent", "setup stack agent in this repo".
disable-model-invocation: true
---

# Set up Stack Agent in this repo

Work through the steps in order. Each step ends with a check you run, not a claim.

## 1. Copy the tools and templates

Run from the repo root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" .
```

It copies `guard.mjs`, `verify.mjs`, `api-map.mjs` into `.stack-agent/bin/` so CI can run them without the plugin. It adds config templates and `.github/workflows/stack-agent.yml` only where none exist, and adds `.stack-agent/evidence/` to `.gitignore`. Re-running it is safe.

## 2. Verification first (`.stack-agent/verify.json`)

Find the repo's real test command and local start command from `package.json`, `Makefile`, `README`, or CI config. Fill `test.command`, `server.command`, `server.env`, `readyUrl`, and `baseUrl`. Add one check per endpoint you can call without outside services. Then run:

```bash
node .stack-agent/bin/verify.mjs
```

Do not continue until it prints `verify: ok`. If the app cannot start locally (missing secrets, external DB), stop and tell the user exactly what is missing. Do not fake a passing check.

## 3. Guard (`.stack-agent/guard.config.json`)

Ask the user for the 3 to 5 rules that must never break, or mine them with `/stack-agent:correct`. For each rule, write `message` and a `fix` that names the file or function to use instead. Rule types: `pattern` (regex in files), `forbidden-import` (JS/TS imports from `files` to `to` paths or `toSpecifiers` packages), `module-boundary` (modules talk only through their public entry). Then record what already exists:

```bash
node .stack-agent/bin/guard.mjs --update-baseline
node .stack-agent/bin/guard.mjs
```

The first command writes the baseline. Old violations are allowed, new ones fail. Prove each rule works: show one real file or a past commit where the rule fires (`--strict` lists every violation, ignoring the baseline).

Config details that cause silent misses if wrong:

- Every list field (`files`, `exclude`, `to`, `toSpecifiers`, `publicEntry`, `ignore`) is an array of strings.
- `to` is a glob of the resolved target file, so `../db/index.js` needs `"to": ["src/db/**"]`, not `"src/db"`.
- Path-alias imports (`@/x`) need `"aliases": {"@/": "src/"}`.
- Delete template rules that do not fit this repo. The guard prints `warning: rule ... matches no files` for them.

Tell the user to add a `.github/CODEOWNERS` line such as `/.stack-agent/ @<team>` so a person must approve any change to the rules or the baseline. The CI workflow also runs `guard.mjs --compare-ref` on pull requests to catch a loosened baseline or removed rule.

## 4. API map

Fill `.stack-agent/api-map.json` `sources` with a regex that finds route declarations. Then:

```bash
node .stack-agent/bin/api-map.mjs --draft > .stack-agent/api-map.md
```

Fill the Handler, Calls, and Owner columns from the code. Leave `TODO` where you are unsure so a human reviews it. Run `node .stack-agent/bin/api-map.mjs` until it prints `api-map: ok`.

## 5. Team rules

Fill `.stack-agent/rules.md` with soft preferences. Add `@.stack-agent/rules.md` to the repo's `CLAUDE.md` so every session loads it. Fill `.stack-agent/rules-table.md` with each hard rule and what enforces it.

## 6. Finish

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" . --check
```

Report the output. Exit 0 means setup is complete. Do not commit. List the files you created and let the user review them.
