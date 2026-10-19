---
name: stack-agent-init
description: Set up Stack Agent in the current repo for any kind of project (backend, CLI, library, frontend, or other): verification config, guard rules with a baseline, an optional API map, team rules, and a CI workflow. Use for /stack-agent-init or "ติดตั้ง stack agent", "setup stack agent in this repo".
disable-model-invocation: true
---

# Set up Stack Agent in this repo

Work through the steps in order. Each step ends with a check you run, not a claim.

## 1. Pick the preset

Look at the repo and pick the closest project type. Tell the user which one and why in one sentence.

| Preset | For | Verify uses |
| --- | --- | --- |
| `backend-http` | APIs and web servers | a server + HTTP checks, plus an API map |
| `frontend-web` | web apps | a dev server + a page check + an e2e command |
| `cli` | command-line tools | command checks (`--help`, main path, bad input) |
| `library` | packages others import | build + an example that uses the public API |
| `generic` | anything else, or unsure | test command + one smoke command |

A repo can mix types. Pick the one users touch first. Checks of both kinds can live in one `verify.json`.

## 2. Copy the tools and templates

Run from the repo root:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" . --preset <preset>
```

It copies `guard.mjs`, `verify.mjs`, `api-map.mjs` into `.stack-agent/bin/` so CI can run them without the plugin, with a `VERSION` file naming the plugin version. It adds the preset's config templates and `.github/workflows/stack-agent.yml` only where none exist, and adds `.stack-agent/evidence/` to `.gitignore`. Re-running it is safe. Node.js 22+ must be installed even when the project uses another language. Only the tools need it.

## 3. Verification first (`.stack-agent/verify.json`)

Find the repo's real test command, and how a user actually runs it, from `package.json`, `pyproject.toml`, `Makefile`, `go.mod`, `Cargo.toml`, the README, or CI config. Replace every `EDIT ME`. Use HTTP checks for things served over HTTP and command checks for everything else. Then run:

```bash
node .stack-agent/bin/verify.mjs
```

Do not continue until it prints `verify: ok`. If the program cannot run locally (missing secrets, an external database), stop and tell the user exactly what is missing. Do not fake a passing check.

## 4. Guard (`.stack-agent/guard.config.json`)

Every preset keeps two universal rules (no merge-conflict markers, no private keys). Replace every `EDIT ME` value, and make sure the config holds the 3 to 5 rules that must never break in this repo. Ask the user, or mine them with `/stack-agent:correct`. For each rule, write `message` and a `fix` that names the file or function to use instead.

- `pattern` works in any language. Patterns are JavaScript regular expressions, always multiline (`^` and `$` match each line). In JSON, write `\\b` for a regex `\b`.
- `forbidden-import` and `module-boundary` read JavaScript/TypeScript and Python imports. For Python, `to` is a glob of the resolved `.py` file (`["app/db.py", "app/db/**"]`), `toSpecifiers` matches dotted names of third-party packages (`["requests"]` also catches `requests.adapters`), absolute imports are found under `pythonRoots` (default `["."]`, plus `"src"` if it exists), and `module-boundary` defaults `publicEntry` to `["__init__.py"]`. For other languages, express the rule as a `pattern` that matches the import line.
- Every list field (`files`, `exclude`, `to`, `toSpecifiers`, `publicEntry`, `ignore`) is an array of strings. `to` is a glob of the resolved target file (`["src/db/**"]`, not `"src/db"`). Path-alias imports need `"aliases": {"@/": "src/"}`.
- Delete template rules that do not fit. The guard prints `warning: rule ... matches no files` for them.

Then record what already exists:

```bash
node .stack-agent/bin/guard.mjs --update-baseline
node .stack-agent/bin/guard.mjs
```

The first command writes the baseline. Old violations are allowed, new ones fail. Prove each rule works on one real file or past commit (`--strict` lists every violation, ignoring the baseline).

Tell the user to add a `.github/CODEOWNERS` line such as `/.stack-agent/ @<team>` so a person must approve changes to the rules or the baseline. The CI workflow also runs `guard.mjs --compare-ref` on pull requests to catch a loosened baseline or a removed rule.

## 5. API map (backend-http only)

Skip this step if `.stack-agent/api-map.json` does not exist. Otherwise fill its `sources` with a regex that finds route declarations (group 1 = method, group 2 = path), then:

```bash
node .stack-agent/bin/api-map.mjs --draft > .stack-agent/api-map.md
```

Fill the Handler, Calls, and Owner columns from the code. Leave `TODO` where you are unsure so a human reviews it. Run `node .stack-agent/bin/api-map.mjs` until it prints `api-map: ok`.

## 6. Team rules

Fill `.stack-agent/rules.md` with soft preferences. Add `@.stack-agent/rules.md` to the repo's `CLAUDE.md` so every session loads it. Fill `.stack-agent/rules-table.md` with each hard rule and what enforces it.

## 7. Finish

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/init.mjs" . --check
```

Report the output. Exit 0 means setup is complete. An `outdated: .stack-agent/bin/<file>` line means a vendored tool differs from the plugin's copy. Rerun step 2 to refresh it; your configs are kept. Do not commit. List the files you created and let the user review them.
