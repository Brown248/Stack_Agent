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
agents/           judge.md, reviewer.md
hooks/            hooks.json (wires scripts/hooks/*.mjs into Claude Code)
skills/<name>/    one SKILL.md per skill, plus any scripts it calls
scripts/          guard.mjs, verify.mjs, api-map.mjs, init.mjs, sample-commits.mjs, lib/, hooks/
templates/        common/ (rules files), ci/ (workflow), presets/<name>/ (verify + guard configs)
examples/         sample-backend (Node HTTP API), sample-cli (Python CLI)
evals/            claude plugin eval cases and scaffold.mjs
tests/            node:test suite for every script and hook
```

Rules that keep forks healthy:

- Scripts are plain Node ESM with zero dependencies. Target repos vendor them into `.stack-agent/bin/`, and CI runs them without `npm install`.
- Every script behavior has a test in `tests/`. Run `npm test` after every change.
- `claude plugin validate . --strict` must pass after you touch `.claude-plugin/`, `skills/`, `agents/`, or `hooks/`.

## Add a preset

1. Create `templates/presets/<name>/` with `verify.json` and `guard.config.json`. Add `api-map.json` only if the preset uses the API map.
2. Keep the universal rules (`no-merge-conflict-markers`, `no-private-keys`) in the guard config.
3. Mark every value the user must fill with `EDIT ME`. `init.mjs --check` reports files that still contain it.
4. Add the name to the expected list in `tests/presets.test.mjs`. The suite already checks that every preset's configs load.
5. Add the preset to the tables in `README.md`, `docs/adoption.md`, and `skills/stack-agent-init/SKILL.md`.

Ideas: `mobile` (simulator commands as command checks), `data-pipeline` (a sample run plus row-count checks), `infra` (`terraform validate` and `plan` as command checks).

## Add a guard rule

Rules live in each project's `.stack-agent/guard.config.json`, not in this repo. To ship a rule to every project on your team, add it to the preset templates.

- `message` says what is wrong. `fix` names the file, function, or module to use instead. The guard rejects a rule without `fix`.
- Prove each rule on a real past mistake before relying on it (`guard.mjs --strict`, or a test fixture).
- For languages other than JS/TS, use `pattern` rules.

To add a new rule *type* (for example, Python imports), extend `findViolations` in `scripts/guard.mjs`, validate its fields in `loadConfig`, and add tests next to the existing ones in `tests/guard.test.mjs`.

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

Protected paths are in `scripts/hooks/protected-paths.mjs`. Every pattern has a row in `tests/hooks.test.mjs`. Add yours there first, then change the code until it passes. Keep ordinary commands in the "lets ordinary commands through" list, so a stricter policy does not block normal work.

## Add an eval case

1. Create `evals/<case>/` with `case.yaml` (`schema_version: "1.1"`, `name`, `context.scaffold_script: scaffold.sh`), `prompt.md` (an organic request that does not mention testing), and `graders/*.md`.
2. `scaffold.sh` calls `node "$(dirname "$0")/../scaffold.mjs"`, which copies `examples/sample-backend` into the run folder. Copy and adapt it for another example.
3. Prefer script graders (`regex`, `file_exists`, `tool_used`). Use `llm` graders only for judgment calls.
4. Run it:

   ```bash
   claude plugin eval . --case <case> --scaffold --runs 1 --no-publish
   ```

   Add `--allow-tools Bash Write Edit` for cases that change code. Those need Linux, macOS, or WSL2.

## Add an example project

Examples double as test fixtures. Copy the layout of `examples/sample-cli`: real source, its own tests, a filled `.stack-agent/` (no `EDIT ME`), and an empty `guard-baseline.json` written by `guard.mjs --update-baseline`. Then add a test file like `tests/sample-cli.test.mjs` that runs the example's guard and verify, and a CI step.
