# Customizing Stack Agent for your team

Stack Agent is meant to be forked. This page shows where each piece lives and how to change it without breaking the rest.

[ภาษาไทย](th/customizing.md)

## Plugin or fork?

| You want to | Do this |
| --- | --- |
| Use it as is and get updates | Install the plugin. Keep project-specific choices in your repo's `.stack-agent/` files. |
| Change skills, hooks, presets, or defaults for your whole team | Fork the repo, edit it, and have the team install from your fork. |
| Own every file inside one project | Copy `skills/`, `agents/`, and `hooks/` into the project's `.claude/` folder and run `init.mjs` for the tools. |

To publish your fork as its own plugin, change `name` in `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (and `owner`, `repository`, `author`), then:

```bash
claude plugin validate . --strict
```

```bash
claude plugin marketplace add <you>/<your-fork>
```

## Repo layout

```
.claude-plugin/   plugin.json, marketplace.json
agents/           judge.md, reviewer.md, finding-verifier.md
hooks/            hooks.json (wires scripts/hooks/*.mjs into Claude Code)
skills/<name>/    one SKILL.md per skill, plus any scripts it calls
scripts/          guard.mjs, verify.mjs, api-map.mjs, feature-map.mjs, init.mjs, sample-commits.mjs,
                  review-findings.mjs, review-worktree.mjs, lib/, hooks/
templates/        common/ (rules files), ci/ (workflow), presets/<name>/ (verify + guard configs)
examples/         sample-backend (Node HTTP API), sample-cli (Python CLI),
                  sample-library (Node package), sample-frontend (static web app),
                  sample-generic (CSV data job)
evals/            claude plugin eval cases and scaffold.mjs
tests/            node:test suite for every script and hook
```

Rules that keep forks healthy:

- Scripts are plain Node ESM with zero dependencies. Target repos vendor them into `.stack-agent/bin/`, and CI runs them without `npm install`.
- `init.mjs --check` reports a vendored file as `outdated` whenever its bytes differ from `scripts/`, so every script change reaches adopters as a prompt to rerun init. A new vendored script goes in `TOOLS` in `scripts/init.mjs`. When you release, bump `version` in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `package.json` together (init writes it to `.stack-agent/bin/VERSION`), and add a section to `CHANGELOG.md` and `CHANGELOG.th.md`.
- Every script behavior has a test in `tests/`. Run `npm test` after every change.
- `claude plugin validate . --strict` must pass after you touch `.claude-plugin/`, `skills/`, `agents/`, or `hooks/`.

## Add a preset

1. Create `templates/presets/<name>/` with `verify.json` and `guard.config.json`. Add `api-map.json` only if the preset uses the API map; a preset without one gets the feature map template (`templates/common/feature-map.md`) from `init`.
2. Keep the universal rules (`no-merge-conflict-markers`, `no-private-keys`) in the guard config.
3. Mark every value the user must fill with `EDIT ME`. `init.mjs --check` reports files that still contain it.
4. Add the name to the expected list in `tests/presets.test.mjs`. The suite already checks that every preset's configs load.
5. Add the preset to the tables in `README.md`, `docs/adoption.md`, and `skills/stack-agent-init/SKILL.md`.

Ideas: `mobile` (simulator commands as command checks), `data-pipeline` (a sample run plus row-count checks), `infra` (`terraform validate` and `plan` as command checks).

## Add a guard rule

Rules live in each project's `.stack-agent/guard.config.json`, not in this repo. To ship a rule to every project on your team, add it to the preset templates.

- `message` says what is wrong. `fix` names the file, function, or module to use instead. The guard rejects a rule without `fix`.
- Prove each rule on a real past mistake before relying on it (`guard.mjs --strict`, or a test fixture).
- Import rules read JS/TS and Python. For other languages, use `pattern` rules.

To add a new rule *type* (for example, imports in another language), extend `findViolations` in `scripts/guard.mjs`, validate its fields in `loadConfig`, and add tests next to the existing ones in `tests/guard.test.mjs`.

## Add a skill

1. Create `skills/<name>/SKILL.md` with frontmatter:

   ```markdown
   ---
   name: <name>
   description: What it does and when to use it, including the words people type. This decides when Claude picks it up.
   ---
   ```

2. Add `disable-model-invocation: true` for skills a person should start on purpose (ones that write many files, cost money, or change shared state). Add `user-invocable: false` for skills only the agent should use.
3. Keep it small and composable. Call `verify` instead of repeating its steps.
4. Put code the agent would otherwise rewrite each time into a script in the skill folder, and reference it with `${CLAUDE_SKILL_DIR}/script.mjs`.
5. Add an eval case (below), so you can tell whether the skill helps.

## Change the hook policy

`scripts/hooks/pre-bash.mjs` decides what shell commands are denied or need a human:

- `deny` is for commands that bypass checks (`--no-verify`).
- `ask` is for destructive or rule-loosening commands.

The git rules (`--no-verify`, hook-disabling variables, force-push, `reset --hard`, branch deletes and force-moves, discarding all changes, deleting `.github/workflows`) apply only inside a Stack Agent project: one with `.stack-agent/verify.json` or `.stack-agent/guard.config.json` in the session's folder or a folder above it. So installing the plugin for your user account does not change how other repositories work. The rules about Stack Agent's own files (the guard config and baseline, `.stack-agent/bin`, the evidence, the session records, `--allow-increase`) apply everywhere. The project is found from the session's folder, so a command that points at another repository (`git -C ../other ...`) is judged by the session's project.

Protected paths are in `scripts/hooks/protected-paths.mjs`. Every pattern has a row in `tests/hooks.test.mjs`. Add yours there first, then change the code until it passes. Keep ordinary commands in the "lets ordinary commands through" list, so a stricter policy does not block normal work.

## Add an eval case

1. Create `evals/<case>/` with `case.yaml` (`schema_version: "1.1"`, `name`, `context.scaffold_script: scaffold.sh`), `prompt.md` (an organic request that does not mention testing), and `graders/*.md`.
2. `scaffold.sh` calls `node "$(dirname "$0")/../scaffold.mjs"`, which copies `examples/sample-backend` into the run folder. Copy and adapt it for another example. A case that starts from a history (a planted bug, a mistake made twice) adds a `setup.mjs` that calls `plant()` from `evals/plant.mjs` and runs it after `scaffold.mjs` (see `debug-blank-name`). `tests/evals.test.mjs` checks that every case is well formed and that each setup plants what its graders expect.
3. Prefer script graders (`regex`, `file_exists`, `tool_used`). Use `llm` graders only for judgment calls.
4. Run it:

   ```bash
   claude plugin eval . --case <case> --scaffold --runs 1 --no-publish
   ```

   Add `--allow-tools Bash Write Edit` for cases that change code. Those need Linux, macOS, or WSL2.

### Running the Bash evals (WSL2, Linux, macOS)

Cases that change code need a sandbox, which native Windows does not have. Notes from running them in WSL2 Ubuntu 24.04:

- Install Node outside `/home`: the eval sandbox cannot read `/home`, so a Node under `~/.local` shows up as "command not found" inside the run. `/usr/local` works.
- Install `bubblewrap` and `socat`, and log in with `claude auth login` inside WSL.
- Docker Desktop's WSL integration puts symbolic links in `~/.docker`, and Claude Code refuses to run a Bash-granting eval with links in that folder. Move `~/.docker` aside for the run and move it back afterwards.
- Pass `--allow-tools Bash Write Edit` (the case's `prompt.md` lists what the case may use; the flag grants it). Give `--case` once per run: only the last one counts.
- Inside `claude plugin eval`, sandboxed Bash cannot write any file, not even in `$TMPDIR` (checked with a probe case). So verify, tests that write a database, and migrations cannot run there. The cases grade honesty (`honest-report`: either real evidence or a plain "could not verify, because") and the code itself, not verify evidence. Measure verification with `scripts/ab/run.mjs`, which runs real sessions.

## Add an example project

Examples double as test fixtures. Copy the layout of `examples/sample-cli`: real source, its own tests, a filled `.stack-agent/` (no `EDIT ME`), and an empty `guard-baseline.json` written by `guard.mjs --update-baseline`. Then add a test file like `tests/sample-cli.test.mjs` that runs the example's guard and verify, and a CI step.

## Measure agent behavior (A/B)

`scripts/ab/run.mjs` runs the same task on a fresh copy of `examples/sample-backend` with and without the plugin, then grades the result with scripts (an independent HTTP probe, the tests, the guard, the API map, and the verify evidence), never with the agent's own summary. It calls `claude -p`, so it spends real money.

```bash
npm run ab -- --task endpoint --task validate --arms full,none --runs 3 --model sonnet --budget 1
```

| Option | Meaning |
| --- | --- |
| `--task NAME` | Task module in `scripts/ab/tasks/`, named after its file (`endpoint`, `validate`, `bug-blank-name`, ...). An unknown name prints the full list. Repeat it for several. Required. |
| `--arms` | Comma list of `full` (the plugin as is), `none` (no plugin), `hooks-only` (a copy without `skills/`), `skills-only` (a copy without `hooks/hooks.json`). Default `full,none`. |
| `--runs N` | Runs per task and arm. Default 1. |
| `--model`, `--budget USD` | Both required. The budget is a per-run cap passed as `--max-budget-usd`; there is no default on purpose. |
| `--plugin DIR`, `--out DIR` | Plugin to test (default: this repo) and where to write results (default: a new folder under the system temp dir). |
| `--no-isolate` | Do not pass `--setting-sources project,local --strict-mcp-config`. Isolation is the default. |
| `--judge MODEL` | Also score the task's `rubric` (criteria a script cannot check, such as "the controller only parses the request") with `agents/judge.md`, run as a second `claude` session with MODEL. The judge reads a blind copy of the run under a random name, with the change as `CHANGES.diff` and without the verify evidence, the skip record, or the Stack Agent configs (only `rules.md` stays), so it cannot tell the arm. Each criterion becomes a `judge:...` column; an unanswered one is not applicable. Off by default: it costs up to `--budget` more per run. |
| `--dry-run` | Scaffold and grade an untouched copy of each project. Never calls `claude`, costs nothing. Use it to check a new task. |
| `--json` | Print the results as JSON instead of the summary table. |

**Cost.** Measured on Sonnet, one run costs about $0.25 to $0.45, so `--runs 3` over 2 tasks and 2 arms is roughly $3 to $5. Try `--dry-run` first.

**Isolation.** Your own plugins and settings would otherwise leak into both arms. Each run therefore uses `--setting-sources project,local` and `--strict-mcp-config` (no user MCP servers), and the harness reads the `system/init` event of every transcript. A run is marked `invalid` and left out of the summary (with a loud message and exit code 1) when the plugin arms loaded any plugin other than `stack-agent`, when the `none` arm loaded any plugin, when `hooks-only` still lists `stack-agent:` skills, or when `skills-only` still shows a Stack Agent hook firing. Plugins that ship inside Claude Code (`@builtin`) are ignored.

**What is recorded.** In `<out>/results.json` for every run: the plugin's git SHA and whether its worktree was dirty, the harness version, `claude --version`, model, arm, task, prompt, budget, start and end time, cost and turns, the number of hook feedback events and the first line, the skills the agent called, the isolation result, and every grader verdict. Raw transcripts are in `<out>/runs/<task>-<arm>-<n>.jsonl` and the run projects in `<out>/projects/`. To see what an agent actually did:

```bash
node scripts/ab/inspect.mjs <out>/runs
```

It lists the skills invoked, the Stop-hook feedback and whether it came before or after the first edit to `verify.json`, the `verify.mjs` runs, and the files edited.

**Add a task.** Drop `scripts/ab/tasks/<name>.mjs` that exports `name`, `prompt`, `probe(dir)` and `grade(dir)`. `probe` returns `{ ok, detail }`; start the server with `withServer` and call it with `call` from `scripts/ab/lib.mjs`, so the harness owns the port and database. `grade` returns `{ checks, details }`, where every value in `checks` is a boolean that the summary counts as `3/3`; start from `commonGrade(dir)` (tests pass, guard ok, fresh and full evidence). A bug-report task exports `setup(dir)`, which plants the bug with `plantBug(dir, edits, message)` from `scripts/ab/lib.mjs` before the session; that commit is tagged `ab-start` and counts as the starting point. A task that only makes sense with the plugin exports `arms` (for example `["full"]`), and one that needs more than the default tools exports `allowedTools` and `addDirs()`. A task can export `rubric`, an array of yes/no questions about the code that only judgment can answer, for `--judge`; keep anything a script can check in `grade`. Check the task with `--dry-run`, and add a case to `tests/ab.test.mjs` that an untouched copy fails and a hand-written solution passes.
