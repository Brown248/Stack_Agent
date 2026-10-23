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
- Evidence records a fingerprint of the code as the run found it: the git blob id of every file git sees under the project (tracked, or untracked and not gitignored), except docs, `*.md`, and `.stack-agent/` (the `stopHookIgnore` list), but always including `verify.json`. Gitignored files such as `.env` are not part of it. Committing does not change it. Editing code or checks afterwards does. If the run itself changes files (snapshots, codegen, a database outside a gitignored folder), they are listed in the output and the Stop hook will not accept that evidence. Gitignore untracked ones; for a tracked file the run rewrites (a coverage report, a fixture), add it to `stopHookIgnore`, which takes effect from the next session.

### The against step: new checks must fail on the code before the change

A check or test that passes before and after a change does not test the change. After a full passing run, verify takes the checks that are new in `verify.json` since a reference commit, and the test suite when test files changed since then, and runs them against the code at that commit, in a temporary git worktree.

- At least one new check, or the changed test suite, must fail on the old code. If they all pass there, the run fails with `FAIL against`, naming them. Usually the fix is to add the rejection case (bad input must be refused), which the old code accepts.
- A unit test counts as much as a verify check: the current tests run on the old code, and a failure there is recorded as `tests (<test command>)` in `detecting`. The step reads the outcome of the whole suite: a test that fails on the old code for an unrelated reason (a fixture or `.env` file the old checkout does not have, a flaky test) also counts as detection. A test that dies on an import the old code lacks (a missing module or export) is inconclusive, and so is a suite that hits its timeout: a test that waits for something the old code never does (a webhook call, a message) should carry its own shorter timeout so that it fails rather than hangs. Changed tests that pass on the old code skip the step rather than fail it, because that is what a refactor looks like; only a new check that passes on the old code fails the run. A deleted test file does not count as a change.
- The usual way this happens: the change adds an export, and its tests import it. On the old code they fail at the import, so they prove nothing, and verify says so, naming the imports it could read from the test output (`SKIP against: the changed tests import something the code at ... does not have (monthlyTotals)`). The evidence records `importMissing` and `missingImports`. Add a verify check that fails without the change: run the program as a user does on an input that reaches the new code, or, if nothing calls it yet, a command check that imports the new function and prints its result. On the old code such a check fails (the export is missing), which is the detection.
- New checks that pass on the old code are fine alongside one that fails. A success case often passes before the change.
- The reference commit is the HEAD the Claude session started from (recorded by the SessionStart hook), so committing mid-task does not hide the change. Without a session record it is `HEAD`. `--against <ref>` sets it. If you run verify in CI, pass `--against origin/<base branch>`: there the default `HEAD` already contains the change, so the step would skip.
- The step is skipped, with the reason in the output, when: the project is not in git, `verify.json` did not exist at the reference, no check is new and no test file changed (renaming a check or changing only `timeoutSec` does not count), or only checks and test files changed (adding coverage for existing behavior). A test that imports a module the old code does not have is inconclusive, not detection. Checks removed since the reference are listed, and so are checks changed under the same name (those run as new checks).
- Results that prove nothing are "inconclusive" and skip the step instead of passing it: the old code's server does not start, a command cannot start, exits 127, times out, or reports a missing module or program (often a gitignored build such as `dist/` that the old checkout does not have), or a request cannot connect. Set `"against": { "required": true }` to fail the run in those cases.
- The worktree gets the current `verify.json` and the current test files (`test/**`, `tests/**`, `__tests__/**`, `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`, `*_test.go`; override with `against.keep`). `node_modules` is linked in from the project (`against.link` sets the list). If the old code needs a build or install first, give `against.setup` a `command` or `args`; with a setup, nothing is linked unless you set `against.link`, because an install through a link would rewrite the real folder. Never put an install in `setup` while linking `node_modules`. `against.tmpDir` moves the worktree off a small system drive. Git hooks do not run on checkout. Links are removed before the worktree is deleted, and leftovers from a killed run are cleaned up two hours later.
- `--no-against` or `"against": false` turns the step off. The evidence records that, and the Stop hook only accepts it when the session started with `"against": false`, so turning the step off after a `FAIL against` does not get past it. Partial runs never run it. It starts the server a second time, so it adds that time to a run with new checks.

### Stop hook

By default (`"stopHook": "block"`) the Stop hook keeps the agent from finishing while code it changed in this session has no matching evidence. Matching means a full passing run whose fingerprint equals the current code.

- Before anything else, the hook runs the guard on the files the session changed (in the working tree, or committed since the session started), compared with the baseline as CI does. A new violation blocks the stop with the rule and its fix, also when it came through the shell (`sed -i`, a script), which the after-edit hook does not see. A skip record does not cover it. Files you left dirty before the session and the agent did not touch are left out. The 3-block cap applies.
- It only holds the agent to changes made in the session: a tree you left dirty before the session does not block, and those files are not listed. Committing the work does not hide it, because the hook compares with the fingerprint taken when the session started.
- The `stopHook`, `stopHookIgnore`, `evidenceDir`, and `against` settings are read when the session starts and kept in a session record at a fixed path (`.stack-agent/evidence/sessions/`, whatever `evidenceDir` says), so editing them in `verify.json` takes effect from the next session, not in the middle of the one being checked. A verify run made with a different `stopHookIgnore` than the session started with is not accepted.
- If the SessionStart hook did not run (the plugin was enabled mid-session), the record is written before the agent's first Edit, Write, MultiEdit, NotebookEdit, or shell command instead. Changes made before that through other tools (an MCP file tool, for example) are not in it. Only when the agent stops before any of these does the hook fall back to `git status` and the live settings.
- A baseline is taken at most once per session (a note in the plugin's data folder, or the system temp folder, remembers it), so deleting the record does not reset it: the hook keeps blocking with "the session record was removed" until the work is verified or skipped. Shell commands that delete, move, or write the session records or those notes (globs included) ask a human first; reading them does not. This is a soft barrier: an agent determined to delete both through an indirect command can still get past it, which is why CI, not the hook, is the final gate.
- When verification truly cannot run (no database, no network), the agent records why with `node .stack-agent/bin/verify.mjs --skip "<reason>"` (at least 15 characters). If it cannot run commands at all (no Node in its sandbox, a read-only checkout), it ends its final message with the line `stack-agent-skip: <reason>`; the Stop hook, which runs outside the sandbox, records the same skip. Only the last line of the message counts, so quoting the marker earlier does nothing. If the user asked not to verify, the reason should say so. That writes `.stack-agent/verify-skip.json`, a file git sees (it is not gitignored), so it appears in `git status` and in the diff once added, and the hook shows the reason to you once. A skip is only valid for the code it was written for; a later change needs verification or a new skip.
- After 3 blocks in a row the hook lets the agent stop and tells you the changes are unverified, so a stuck agent cannot loop. A new message from you resets the count.
- Edit/Write on `latest.json`, `verify-skip.json`, or the session records in `evidence/sessions/` asks a human first. Only Stack Agent's own scripts write them. A custom `evidenceDir` is covered too: both the one the session started with and the one in `verify.json` now. A determined shell write can still change these files; CI is the gate that cannot be bypassed.
- When the evidence matches the code but the against step was inconclusive because the changed tests import something the old code lacks (and no new check was added), the hook blocks once more and asks for a check that fails without the change, naming the imports and showing a command check that calls the new function directly for code nothing calls yet. If the agent stops again without one, it is let through. `"stopHook": "remind"` does not ask. In the A/B run of 2026-10-23, an earlier wording that said "if nothing a user can run reaches this change, say so and stop" was taken as the way out in 4 of 4 runs.
- Likewise, when the evidence matches the code but the code changed and no check or test is new or changed (the against step then has nothing to run and records `noNewCoverage`), the hook blocks once and asks for a test or check that fails without the change, or for the agent to say that nothing a user can observe changed. Changes only to files the fingerprint ignores (docs, `*.md`) are not flagged. Found in the `job-new-export` A/B runs, where one agent per round changed the code, wrote no test, verified, and stopped.
- `"stopHook": "remind"` restores the earlier behavior: one reminder per change set, then the agent may stop.

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
- `files`, `exclude`, `to`, `toSpecifiers`, `publicEntry`, `ignore`, and `declinedRules` are arrays of strings. A plain string is a config error.
- These folders are always skipped: `node_modules`, `.git`, `dist`, `build`, `coverage`, `__pycache__`, `.venv`, `venv`, `.tox`, `.pytest_cache`, `.mypy_cache`, `target`, `.stack-agent/evidence`, `.stack-agent/bin`. Add more with `ignore`.
- In a git repo the guard and the API map read only the files git would commit: tracked files, plus untracked ones that are not gitignored. A gitignored `.env` or key file is not scanned, the same as in CI, where it does not exist. This also holds for files named with `--files` and for the after-edit hook. A tracked file is scanned even if a gitignore pattern matches it. Outside git, every file under the root is scanned.
- Files over 1 MB are not checked. The guard names each one in a warning; add it to `ignore` if that is intended.
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

**Shared rules.** Projects in one repository (a monorepo) can share rules: put them in a JSON file with its own `rules` array and list it in each project's config:

```json
{ "extends": ["../../stack-agent-rules.json"], "rules": [] }
```

- Paths are relative to the file that names them, and a shared file may extend others. Every file must be inside the repository, so CI's checkout and `--compare-ref` can read it.
- Shared rules come first. A project adds its own rules but cannot redefine a shared one (the guard stops with a config error), so loosening a shared rule means changing the shared file.
- `--compare-ref` reads the shared files as they were at the base commit, so a pull request that removes or narrows a shared rule fails, even when no project's config changed.
- The hooks ask a human before an edit or a shell write to a shared file. Put it under CODEOWNERS too.
- Each project still has its own baseline.

Inline exceptions need a reason, an expiry date, and an approver:

```js
// stack-agent-allow no-sql-in-controller reason="export report, ticket 42" until=2026-12-31 by=lead
```

- A comment on its own line covers the next line. A trailing comment covers its own line only.
- The date must be a real date within `maxAllowDays` (90 by default, configurable), and the rule id must exist.
- After the date passes, the guard fails again.
- The guard cannot prove `by=` approved it. Code review does that (see below).

CI: `.github/workflows/stack-agent.yml` runs the guard, runs `guard.mjs --compare-ref origin/<base>` on pull requests (it fails if the baseline grew or a rule was removed or narrowed), and runs the API map check when `api-map.json` exists. A separate `verify` job runs `node .stack-agent/bin/verify.mjs` on every push and pull request, with `--against origin/<base>` on pull requests, and uploads `.stack-agent/evidence/` as an artifact. That job is what makes a forged `latest.json` worthless. It is on by default and stays red until `verify.json` is filled in and you have replaced the `EDIT ME: install your dependencies` step (`npm ci`, `pip install ...`, a `services:` block for a database). `init.mjs --check` reports that step. The job is not skipped when placeholders remain, because a skip keyed to a text marker would let a pull request switch the gate off. Make `guard` and `verify` required status checks and put `.github/workflows/` and `.stack-agent/` under CODEOWNERS, since a pull request can still edit the workflow or weaken `verify.json`. On another CI system, run the same commands.

The workflow runs on pull requests and on pushes to the repository's default branch. `init` reads that branch from `origin/HEAD` (set by a clone) and writes it in place of the template's `main`. Without `origin/HEAD` (a repository with no remote yet) it keeps `main`, and `init.mjs --check` notes that the branch is not known yet. It also notes a workflow whose `branches` does not include the default branch.

**Monorepos.** GitHub reads workflows only from `.github/workflows/` at the top of the repository. When the project is in a subfolder (`init.mjs services/api`), `init` writes `.github/workflows/stack-agent-services-api.yml` at the top instead. That workflow runs its commands in `services/api` (`defaults.run.working-directory`), runs only when files under that folder or the workflow itself change (`paths`), and uploads that folder's evidence. Each project in the repository gets its own workflow. `init.mjs --check` names a `stack-agent.yml` left inside the subfolder, which GitHub never runs. `--compare-ref` and the against step compare the project's own files at the base commit.

### Keeping the guard from being switched off

The easiest way around a rule is to edit the guard itself. There are three layers against that:

1. **While working:** hooks ask a human before Edit/Write or a shell command (Bash or PowerShell) changes `guard.config.json`, `guard-baseline.json`, `.stack-agent/bin/`, `stack-agent.yml`, or a monorepo's `stack-agent-<folder>.yml` (or deletes the `.github` or `.github/workflows` folder; adding or copying a workflow there does not ask). That includes inline scripts (`node -e`, `node --eval=`, `-pe`, `python -c`, `py -3 -c`, `deno eval`), also when they build the path with `path.join` or `os.path.join`.
2. **In CI:** `--compare-ref` fails when the baseline grows or a rule is removed or narrowed.
3. **In review:** add `.github/CODEOWNERS` so a named owner must approve any change under `.stack-agent/`, for example `/.stack-agent/ @your-org/leads`. `init` does not create it because it does not know your team.

Remaining gaps: the PostToolUse hook checks files edited through Edit/Write. Edits made through shell commands (`sed -i`) are caught later by CI and the Stop hook. The shell hooks match patterns, so they do not cover every possible form: a path assembled from variables, an interpreter they do not know, or a script file run with `node fix.js` passes them. CI is the gate that must always exist.

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

### Feature map (every other preset)

`init` gives the `generic`, `cli`, `library`, and `frontend-web` presets `.stack-agent/feature-map.md`: a table of what a user does and where it lives, which an agent reads before searching the repo (the `feature-map` skill).

| Column | Holds |
| --- | --- |
| Feature | what the user does |
| Where | places separated by commas: a repo path, `path:line`, or `path#text`, where text must appear in that file (a selector, a flag, a label, a function name) |
| How a user reaches it | the screen and clicks, the command, or the call a consumer makes |
| Check | names of checks in `verify.json` that exercise it, or `-` |

```bash
node .stack-agent/bin/feature-map.mjs --draft
node .stack-agent/bin/feature-map.mjs
```

`--draft` prints one row per verify check to start from. The check fails (exit 1) when a file in `Where` is gone, a line is past the end of its file, an anchor text is no longer in its file, or a named check is not in `verify.json`. It warns on a feature with no check and on `TODO` cells. CI runs it when the file exists. Prefer `path#text` to `path:line`: the text changes only when what the user touches changes. Projects set up before the feature map existed do not get it on an `init` rerun; start one with `--draft`. The four non-backend examples each have one.

## 4. Team rules and a setup check

- Fill `.stack-agent/rules.md` with soft preferences, then add `@.stack-agent/rules.md` to the repo's `CLAUDE.md` so every session loads it.
- Fill `.stack-agent/rules-table.md` with every must-not-break rule: the rule, why, what enforces it, and proof that it catches a real mistake.

```bash
node <path-to-Stack_Agent>/scripts/init.mjs . --check
```

Exit 0 means setup is complete. Otherwise it lists what is left.

`--check` also compares every file in `.stack-agent/bin/` with the plugin's current copy. A file that differs or is missing appears as `outdated: .stack-agent/bin/<file>` and counts as unfinished setup (exit 1). This tells you that your vendored guard or verify is older than the plugin and may lack recent fixes. Refresh them by rerunning `node <path-to-Stack_Agent>/scripts/init.mjs .`, which rewrites only the tools and never touches your configs. `.stack-agent/bin/VERSION` records which plugin version the tools came from.

The hooks run the plugin's own scripts, while CI runs the copies in `.stack-agent/bin/`, so a stale copy can make the two judge the same code differently. The SessionStart hook therefore runs the same comparison in every session and, when a vendored file differs, tells you which ones and the command that refreshes them (it tells you, not the agent, so nothing is rewritten without you). Evidence also records the version of the fingerprint it was computed with (`fingerprintVersion`); if a vendored `verify.mjs` computes it differently from the hooks, the Stop hook says so instead of reporting that the code changed.

It also notes any rule that every preset ships (`no-merge-conflict-markers`, `no-private-keys`, `no-debug-tags`) and your guard config lacks, with the preset file to copy it from. The note does not change the exit code, since leaving a rule out can be a choice: list the rule id in `"declinedRules"` in `guard.config.json` to say so, and the note stops.

## 5. Skills

- `verify` works for every project.
- For backends: `add-endpoint`, `add-migration`, and `api-map`.
- Add skills for your team's 2 to 3 most frequent tasks under `.claude/skills/<name>/SKILL.md`. If the agent keeps writing the same code, save it as a script in the skill's folder.
- After a long task, `/stack-agent:reflect` proposes skill edits from what went wrong. You approve them first.
- `/stack-agent:mine-corrections` does the same across past sessions: `scripts/mine-transcripts.mjs` reads the transcripts Claude Code keeps for this project on your machine (read-only, nothing leaves it), lists what you wrote right after an agent reply, and the skill groups the corrections that repeat in at least two sessions and proposes a check, skill edit, or rule for each, with the quoted messages as evidence. You approve them first.
- When you correct the agent twice for the same thing, `/stack-agent:correct` turns it into a guard rule with proof that it fires.
- `/stack-agent:sample-review` spot-checks recent commits and feeds repeat problems to `correct`.
- `/stack-agent:debug` fixes a bug by first making it fail on demand: the repro becomes a verify check or a test, so the against step proves it fails on the code before the fix. Debug lines carry a `[DEBUG-xxxx]` tag, and the `no-debug-tags` guard rule (in every preset; Markdown, logs, and build output excluded) fails on any left behind when the guard or CI runs. The rule carries `"onEdit": "skip"`, so the after-edit hook does not stop the agent from adding them mid-task; any rule can use that option. Projects set up before this rule do not get it, because `init` never rewrites an existing guard config; `init.mjs --check` names it (see section 4).

### Sampling review: findings as data, checked by a second agent

`sample-review` reviews each sampled commit in a checkout of that commit (`review-worktree.mjs add <sha>`), because Read, Grep, and Glob only see the files on disk: in the main working tree every `path:line` would point at today's code. The checkout is a temporary git worktree with hooks off and `node_modules` linked in, removed at the end.

The `reviewer` agent reports candidates, not verdicts, as a JSON array. Each one names a `source` (`guard:<rule-id>`, `api-map`, `verify-evidence`, `rules.md:<line>`, `correctness`, or `spec`), a location, and evidence, and every location and evidence entry quotes the code it points at. A separate `finding-verifier` agent gets only the claims and locations, never the reviewer's evidence, tries to refute each one, and decides:

- `confirmed`: with `severity` (`blocking` or `non-blocking`), `kind` (`repeatable` goes to `/stack-agent:correct`, `one-off` does not), what it `observed`, and a `fix`.
- `hardening`: the problem would be real, but another layer in the code already stops it (validation at the boundary, a guard rule, a database constraint). It records the `control` and a `suggestion`, and is reported apart from problems, so defense-in-depth ideas do not crowd the list of things that are broken.
- `needs_validation`: only when a fact the code cannot show decides it, with the `blockers` and `how_to_check`.
- `rejected`: with a `reason`.

A `spec` finding compares the change with what it was asked to do, separately from the rules: a missing requirement, behavior nobody asked for, or a requirement built wrongly. It quotes the request in `spec: { from, quote }`, where `from` is `commit-message` (sample-review passes each commit's message) or a file holding the request (for a review of the current change, the skill saves the user's request as `spec.md` in the run folder), and the validator checks that the quote is really there. A commit message that only names the change ("fix bug") gives the reviewer nothing to compare, so it skips the spec check.

The review log is also the ledger for the next sample: `sample-commits.mjs` skips commits it already lists as reviewed (rows whose action starts with `not reviewed` do not count) and picks commits that touch files no reviewed commit has touched before the rest. `--no-ledger` samples at random as before. A commit whose findings still need validation counts as reviewed: the review happened, and the open question is listed in the log. A commit that only appends to the log is never sampled. With the ledger on, `--seed` repeats a pick only while the log is unchanged. A file counts as covered once any reviewed commit touched it, so a file that was reviewed long ago and has changed a lot since still counts as covered.

Both agents run git as `git -C "<review root>" ...` and pass `--root` to the Stack Agent checks instead of changing directory, because permission rules refuse a `cd` in front of a git command. If the diff cannot be read, the reviewer stops with no candidates (the commit is logged as not reviewed), and the verifier stops too, so its candidates are recorded as `needs_validation`. A file the commit deleted is cited as it was before the commit; the validator reads it from the commit's parent.

Guard and API-map candidates are not sent to the verifier: the skill reruns the check itself and records `verified_by: "script:<command>"`. The skill, not the agents, sets `found_by` and `verified_by`. At most 8 candidates per run go to the verifier; the rest become `needs_validation`.

`review-findings.mjs validate` checks every file before it is used: the fields each verdict needs or must not have, unique ids, that the finder is not its own verifier, that a script verifier is used only for a guard, API-map, or evidence finding, that a cited guard rule and `rules.md` line exist, that each quoted excerpt appears within 3 lines of its cited line in the reviewed commit (`--root <checkout>` or `--ref <commit>`), that a finding about a commit cites (in its location or one evidence entry) a file that commit changed, so a problem that was already there is not pinned on the commit under review, and, with `--candidates`, that no candidate was dropped on the way. It proves format and grounding only, not that a finding is right. `review-findings.mjs rows` turns the final file into review-log rows. The files live in `.stack-agent/evidence/review/<date>-<seed>/`, which is gitignored with the rest of the evidence; `.stack-agent/review-log.md` is the record you commit.

For the change you are working on, the reviewer also runs `node .stack-agent/bin/verify.mjs --evidence-status`, which says whether the latest evidence is a full pass for the code as it is now and runs nothing. Projects set up before this flag existed need their vendored tools refreshed: rerun `node <path-to-Stack_Agent>/scripts/init.mjs .` (`init.mjs --check` lists `.stack-agent/bin/verify.mjs` as outdated until you do).

## 6. Evals

Add evals once you have skills to measure. See `/stack-agent:run-evals`. Aim for one case per skill, and read the delta between with and without the plugin, not only the score.

## Not included on purpose

Auto-merge and an outer loop that pulls work from Slack or an issue tracker are not included. Start with the agent doing the work and a human reviewing it, with the `reviewer` agent as a first pass. Add autonomy once verification and the guard have earned it.
