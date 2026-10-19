# Adopting Stack Agent in your project

Work through the steps in order. Each one ends with a command that has to pass, not a claim. The order comes from one idea: if the agent cannot check its own work, nothing else can be trusted.

[ภาษาไทย](th/adoption.md)

## 0. Install

Install the plugin (see the [README](../README.md)), then in Claude Code inside your project run `/stack-agent:stack-agent-init`. It walks through every step below. To do it by hand:

```bash
node <path-to-Stack_Agent>/scripts/init.mjs . --preset <preset>
```

Presets: `generic` (default), `backend-http`, `frontend-web`, `cli`, `library`. `node <path-to-Stack_Agent>/scripts/init.mjs --list-presets` prints them. Pick the type users touch first. One `verify.json` can hold both HTTP and command checks.

`init` records the preset in `.stack-agent/preset` and reuses it on later runs. It refuses to mix in a different preset, because that would keep the old preset's configs next to the new one's files. To switch, delete `.stack-agent/preset` and the `.stack-agent/*.json` files you want replaced, then run it again.

The tools in `.stack-agent/bin/` are committed with your project (CI runs them from there), so a few `.mjs` files will show up in diffs even in non-JavaScript repos. `init` refreshes them when you update Stack Agent.

## 1. Verification

Edit `.stack-agent/verify.json` and replace every `EDIT ME`.

- `test.command` (or `test.args`): how the repo runs its tests (`npm test`, `pytest`, `go test ./...`, `cargo test`).
- `server` (optional): how to start the program locally, with `env` and a `readyUrl` that answers once it is up.
- `checks[]`: what a user would do, each with a success case and at least one rejection case.

Two kinds of check:

| Kind | Fields | Use for |
| --- | --- | --- |
| HTTP | `method`, `path`, `expectStatus`, optional `body`, `headers`, `expectJson`, `expectBodyIncludes` (needs `baseUrl`) | APIs, web pages |
| Command | `command` or `args`, optional `expectExit` (default 0), `expectOutputIncludes`, `expectOutputExcludes`, `expectOutputMatches`, `expectOutputFlags` (default `m`), `needsServer`, `cwd`, `env`, `timeoutSec` (default 120) | CLIs, libraries, scripts, e2e runners, anything |

Command checks in detail:

- Give each command one of two ways, never both. `"command": "pytest -q"` is a string run through the platform shell: `cmd.exe` on Windows and `/bin/sh` elsewhere, so quoting differs by OS. Single quotes are not quotes in `cmd.exe`, so `python -c 'print(1)'` silently does the wrong thing on Windows.
- `"args": ["python", "-c", "print('hi there')"]` runs the program directly, with no shell, so each item arrives as exactly one argument on every OS. Use `args` for anything with quotes, spaces inside an argument, or characters like `&`, `|`, `%`. `test` and `server` take `args` too. Evidence records the request as the args joined with spaces, plus the `args` array.
- Without a shell there are no pipes, `&&`, globs, or `$VAR` expansion. On Windows, `args` also runs only real programs (`.exe`): `npm`, `npx`, and other `.cmd` or `.bat` scripts fail to start (verify says so and points here). Use `command` for those (`"command": "npm test"`), or call `node` with the script's path.
- Name interpreters the way your CI and teammates have them. `python` exists on Windows and with `actions/setup-python`; stock macOS and Debian only have `python3`.
- Output means stdout and stderr together. The expectations see the whole output up to 8 MB. Above that, the middle is dropped and the check fails with a note, so make very noisy commands quieter.
- `expectOutputMatches` is a JavaScript regular expression, case-sensitive by default. `expectOutputFlags` sets the flags (default `m`, so `^` and `$` match each line; use `im` to ignore case).
- Command checks do not start the server. Set `"needsServer": true` on a command check that needs it, such as browser tests.

```bash
node .stack-agent/bin/verify.mjs
```

It must print `verify: ok`. If the program needs secrets or an outside database, find a local way to run it (docker compose, a test database) first. Never fake a check to get past it.

Behavior to know:

- Verify never drives a server it did not start. If the port is already taken, it stops and says so. `--reuse` drives an already-running server on purpose.
- The server, and any test command or command check that runs past its timeout, are stopped with their whole process tree.
- `baseUrl` may include a path prefix, such as `http://127.0.0.1:3999/api/v1`.
- Only a run with no flags counts as done (`"full": true` in `latest.json`). `--skip-tests`, `--skip-checks`, `--check`, and `--reuse` are for iterating. The Stop hook does not accept them as evidence.

## 2. Guard

Put the 3 to 5 rules that must never break in `.stack-agent/guard.config.json`. Each needs a `message` and a `fix` that names what to use instead. Keep the two universal rules. Delete or adapt template rules that do not fit your layout. The guard warns `rule ... matches no files` for those.

| Type | Use when | Fields |
| --- | --- | --- |
| `pattern` | text that must never appear in some files, in any language | `files`, `pattern`, `flags`, `exclude` |
| `forbidden-import` | JS/TS or Python files that must not import certain files or packages | `files`, `to` (glob of the resolved target file), `toSpecifiers` (glob of package or dotted module names) |
| `module-boundary` | JS/TS or Python modules that may talk only through a public entry | `modulesRoot`, `publicEntry` |

**`forbidden-import` and `module-boundary` understand JavaScript, TypeScript, and Python (`.py`) imports.** In any other language, delete them from the template and write the same rule as a `pattern`.

Details that cause silent misses:

- Patterns are JavaScript regular expressions, not Python or PCRE. Python-only syntax such as `(?P<name>...)` is an error.
- Patterns are always multiline: `^` and `$` match at every line, not only at the start and end of the file. Add `"flags": "i"` to ignore case.
- Patterns live in JSON, so every backslash is doubled: a regex `\bSELECT\b` is written `"\\bSELECT\\b"`. A single `\b` in JSON becomes a backspace character, and the guard rejects it as a config error.
- `files`, `exclude`, `to`, `toSpecifiers`, `publicEntry`, and `ignore` are arrays of strings. A plain string is a config error.
- These folders are always skipped: `node_modules`, `.git`, `dist`, `build`, `coverage`, `__pycache__`, `.venv`, `venv`, `.tox`, `.pytest_cache`, `.mypy_cache`, `target`, `.stack-agent/evidence`, `.stack-agent/bin`. Add more with `ignore`.
- `to` matches the file an import resolves to. Importing `../db/index.js` needs `"to": ["src/db/**"]`. `"src/db"` matches nothing.
- Globs support `*`, `**`, `?`, and `{js,ts}`.
- Path-alias imports (`@/modules/x`) need `"aliases": {"@/": "src/"}`.
- Import rules skip imports inside comments (and, in Python, inside strings and docstrings).
- Python: `import a.b`, `from a.b import x`, relative `from ..pkg import x`, and parenthesized multi-line imports are all read. Relative imports resolve against the importing file's package. Absolute ones are looked up under `pythonRoots` (default `["."]`, plus `"src"` when a `src/` folder exists) as `<mod>.py`, then `<mod>/__init__.py`. `from pkg import name` counts as importing `pkg/name.py` when that file exists. Example: `"files": ["app/api/**"], "to": ["app/db.py", "app/db/**"]`.
- Python modules that are not found in the repo (third-party) are matched by `toSpecifiers` on their dotted name, and a package name also matches its submodules: `"toSpecifiers": ["requests"]` catches `import requests.adapters`.
- For Python, `module-boundary` defaults `publicEntry` to `["__init__.py"]`, so other modules may import the package but not the files inside it.
- For other languages, write the rule as a `pattern` that matches the import line.

```bash
node .stack-agent/bin/guard.mjs --update-baseline
node .stack-agent/bin/guard.mjs
```

The first command records existing violations in `guard-baseline.json`. From then on, the guard fails only when a file gains violations. The ratchet counts per file per rule: fixing one old violation and adding a new one in the same file nets zero and passes, and a renamed file loses its baseline entry.

Lowering the baseline is always allowed. When `--update-baseline` sees a count go up, it refuses and exits 1. Raising a count needs `--allow-increase`, and the hook asks a human first. The very first baseline, when none exists yet, is the exception.

Import rules (`forbidden-import`, `module-boundary`) count each imported name, not each statement. `import { a, b } from "x"` counts 2, so adding a name to an import that is already in the baseline fails. Default, namespace (`* as ns`), side-effect, and `from x import *` imports count 1. Destructured `require` and `await import` count each name. Pattern rules count each match.

Baselines written before this rule have `"version": 1` and counted statements. The guard still reads them that way and prints a note asking you to upgrade. Run `--update-baseline` on a clean tree, in a commit of its own: it writes `"version": 2` without needing `--allow-increase`, as long as no statement was added. `--compare-ref` across the upgrade compares statement counts with the old file and lists each file whose count grew under the new unit, so a reviewer can check it. A baseline version that goes down fails `--compare-ref`.

Inline exceptions need a reason, an expiry date, and an approver:

```js
// stack-agent-allow no-sql-in-controller reason="export report, ticket 42" until=2026-12-31 by=lead
```

- A comment on its own line covers the next line. A trailing comment covers its own line only.
- The date must be a real date within `maxAllowDays` (90 by default, configurable), and the rule id must exist.
- After the date passes, the guard fails again.
- The guard cannot prove `by=` approved it. Code review does that (see below).

CI: `.github/workflows/stack-agent.yml` runs the guard, runs `guard.mjs --compare-ref origin/<base>` on pull requests (it fails if the baseline grew or a rule was removed or narrowed), and runs the API map check when `api-map.json` exists. On another CI system, run the same commands.

### Keeping the guard from being switched off

The easiest way around a rule is to edit the guard itself. There are three layers against that:

1. **While working:** hooks ask a human before Edit/Write or a shell command (Bash or PowerShell) changes `guard.config.json`, `guard-baseline.json`, `.stack-agent/bin/`, or `stack-agent.yml`.
2. **In CI:** `--compare-ref` fails when the baseline grows or a rule is removed or narrowed.
3. **In review:** add `.github/CODEOWNERS` so a named owner must approve any change under `.stack-agent/`, for example `/.stack-agent/ @your-org/leads`. `init` does not create it because it does not know your team.

Remaining gaps: the PostToolUse hook checks files edited through Edit/Write. Edits made through shell commands (`sed -i`) are caught later by CI and the Stop hook. The shell hooks match patterns, so they do not cover every possible form. CI is the gate that must always exist.

## 3. Feature map (backend-http)

Skip this step unless `.stack-agent/api-map.json` exists. Set `sources` to one or more regexes that find route declarations. By default group 1 is the method and group 2 is the path (change them with `methodGroup` and `pathGroup`). When the method is not on the same line as the path, add one source per method with a fixed `"method"`; group 1 is then the path.

| Framework | `files` | `pattern` (as written in JSON) | Extra |
| --- | --- | --- | --- |
| Express | `["src/**/*.js"]` | `"router\\.(get\|post\|put\|patch\|delete)\\(\\s*['\"]([^'\"]+)"` | |
| FastAPI | `["app/**/*.py"]` | `"@\\w+\\.(get\|post\|put\|patch\|delete)\\(\\s*\"([^\"]+)\""` | |
| Flask (one method per route) | `["app/**/*.py"]` | `"@\\w+\\.route\\(\\s*\"([^\"]+)\""` | `"method": "GET"` |
| Go net/http 1.22+ | `["**/*.go"]` | `"HandleFunc\\(\\s*\"(GET\|POST\|PUT\|PATCH\|DELETE) ([^\"]+)\""` | |

Routes that accept several methods in one declaration (Flask `methods=[...]`, Django `path()`) need one source per method, or a small script that writes the map.

```bash
node .stack-agent/bin/api-map.mjs --draft > .stack-agent/api-map.md
node .stack-agent/bin/api-map.mjs
```

`--draft` fills Handler with the file and line that declares each route. Point it at the real handler file (`path` or `path:line`, both are accepted) and fill Calls and Owner from the code. Leave `TODO` where unsure so a human reviews it.

The second command:

- **fails (exit 1)** when the map and the code disagree: a route missing from the map, a row with no route, or a handler path that does not exist.
- **warns without failing** when an endpoint has no verify check or a row still has `TODO`.

The map is a markdown table whose first column is the HTTP method and second is the path, as the regex captures it. Routes mounted under a prefix (`app.use("/items", router)`) appear without the prefix unless your regex includes it.

For other project types, the same idea (a map from what users touch to where the code lives) can be a plain markdown file the agent reads first. A drift check for it is a natural next preset to add.

## 4. Team rules and a setup check

- Fill `.stack-agent/rules.md` with soft preferences, then add `@.stack-agent/rules.md` to the repo's `CLAUDE.md` so every session loads it.
- Fill `.stack-agent/rules-table.md` with every must-not-break rule: the rule, why, what enforces it, and proof that it catches a real mistake.

```bash
node <path-to-Stack_Agent>/scripts/init.mjs . --check
```

Exit 0 means setup is complete. Otherwise it lists what is left.

`--check` also compares every file in `.stack-agent/bin/` with the plugin's current copy. A file that differs or is missing appears as `outdated: .stack-agent/bin/<file>` and counts as unfinished setup (exit 1). This tells you that your vendored guard or verify is older than the plugin and may lack recent fixes. Refresh them by rerunning `node <path-to-Stack_Agent>/scripts/init.mjs .`, which rewrites only the tools and never touches your configs. `.stack-agent/bin/VERSION` records which plugin version the tools came from.

## 5. Skills

- `verify` works for every project.
- For backends: `add-endpoint`, `add-migration`, and `api-map`.
- Add skills for your team's 2 to 3 most frequent tasks under `.claude/skills/<name>/SKILL.md`. If the agent keeps writing the same code, save it as a script in the skill's folder.
- After a long task, `/stack-agent:reflect` proposes skill edits from what went wrong. You approve them first.
- When you correct the agent twice for the same thing, `/stack-agent:correct` turns it into a guard rule with proof that it fires.
- `/stack-agent:sample-review` spot-checks recent commits and feeds repeat problems to `correct`.

## 6. Evals

Add evals once you have skills to measure. See `/stack-agent:run-evals`. Aim for one case per skill, and read the delta between with and without the plugin, not only the score.

## Not included on purpose

Auto-merge and an outer loop that pulls work from Slack or an issue tracker are not included. Start with the agent doing the work and a human reviewing it, with the `reviewer` agent as a first pass. Add autonomy once verification and the guard have earned it.
