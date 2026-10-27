# Stack Agent

A Claude Code plugin and template that turns your team's know-how into structure an AI agent cannot skip: verification with evidence, guard rules that ratchet, hooks that stop shortcuts, small skills with scripts, a blind judge, and evals that measure whether any of it helps.

It works for any kind of project. Presets cover HTTP backends, web frontends, CLIs, and libraries, and the core works for anything you can test with a command. Install it as a plugin, or fork it and make it yours.

[ภาษาไทย](README.th.md)

- [Why](#why) · [How it works](#how-it-works) · [Install in your project](#install-in-your-project) · [Daily use](#daily-use) · [Troubleshooting](#troubleshooting)
- [What you get](#what-you-get) · [Presets](#presets) · [Examples](#examples) · [Requirements and limits](#requirements-and-limits)

## Why

AI agents write code fast, but three things keep you watching every line:

- They say "it should work" without running anything.
- They take the shortest path that compiles, and the structure rots.
- They repeat mistakes, because a rule in a prompt is easy to forget.

Stack Agent moves rules out of prompts and into things that fail loudly: a verify run that must pass, a guard that fails CI, and hooks that stop the agent at the moment it reaches for a shortcut. The ideas come from Lauren Tan's talks on pstack and from how Anthropic engineers build Claude Code skills. See [docs/design-notes.md](docs/design-notes.md).

## How it works

Stack Agent acts in three places. The first two give the agent fast feedback. The third is the one that cannot be talked around.

| Where | What runs | What it is for |
| --- | --- | --- |
| **Your repository** | `.stack-agent/`: the tools (`bin/`), your config (`verify.json`, `guard.config.json`), your rules, and the evidence of each verify run | Everything is plain files you commit and review. CI runs the copies in `.stack-agent/bin/`, so it needs no plugin. |
| **The agent's session** (the plugin's hooks, in a project that has `.stack-agent/verify.json`) | Hooks around every edit and shell command, and when the agent tries to stop | Stops common shortcuts at the moment they happen, and makes the agent prove its work. |
| **CI** (`.github/workflows/stack-agent.yml`) | The guard, the feature or API map check, and verify, on every push and pull request | The gate that always holds. A hook can be argued with; a red check cannot. |

One change goes through this loop:

```
agent edits a file ──► guard runs on that file ──► new violation? reported with the rule and the fix
        │
        ▼
agent runs verify ──► tests, your server, HTTP and command checks, the "against" step
        │               └─► evidence file, tied to a fingerprint of the code as it is now
        ▼
agent tries to stop ──► Stop hook: does the evidence match the code?
        │                 no  ──► blocked (up to 3 times in a row), told what to run
        │                 yes ──► allowed
        ▼
you open a pull request ──► CI reruns the guard (ratchet and --compare-ref) and verify (with against)
```

The ideas that make it work:

- **Evidence, not claims.** `verify` runs your tests, starts your server if you have one, runs HTTP and command checks, and writes a record to `.stack-agent/evidence/`. The record carries a fingerprint of the code (by default Markdown files, `docs/`, and `.stack-agent/` are left out; `stopHookIgnore` changes that list). Edit the code after verifying and the old evidence no longer counts.
- **A ratchet, not a clean slate.** `guard` checks rules you write: a regex for any language, plus import rules for JS/TS and Python. A baseline (`guard-baseline.json`) records the violations that exist today. Those pass; a new one fails, and raising the baseline needs a human's `--allow-increase`. In CI, `--compare-ref` fails a pull request that raises the baseline or loosens a rule.
- **New checks must fail on the old code.** On a pull request, the `against` step runs your new checks and tests against the code before the change. A check that also passes there proves nothing, so the step fails it.
- **Hooks catch the common shortcut. CI catches the rest.** The hooks match command patterns: they deny `git commit --no-verify`, `HUSKY=0`, and `core.hooksPath` tricks, ask before a force push, `reset --hard`, or an edit to the guard's own config, and run the guard after every edit and on files a shell command changed. A determined workaround can slip past a hook; it cannot slip past a required CI check ([docs/adoption.md](docs/adoption.md) shows how to make it required).

## Install in your project

You need Node.js 22 or newer (only to run the tools; the project can use any language) and git. Claude Code is needed for the hooks and skills; the guard and verify also run on their own and in CI.

### 1. Install the plugin

```bash
claude plugin marketplace add Brown248/Stack_Agent
```

```bash
claude plugin install stack-agent@stack-agent-marketplace
```

By default this installs for you in every project. Add `--scope project` to the second command to record it in the project's `.claude/settings.json` for the whole team, or `--scope local` to keep it to this project on your machine. Restart Claude Code afterwards.

### 2. Set up the project

Start Claude Code in your project and run:

```
/stack-agent:stack-agent-init
```

It asks which preset fits, fills in the config, and runs each check until it passes. To do the same by hand (also the way to use Stack Agent in CI with no plugin at all), run from the project's root, with any preset from [Presets](#presets):

```bash
node path/to/Stack_Agent/scripts/init.mjs . --preset generic
```

It copies the tools into `.stack-agent/bin/` and adds config templates and a GitHub Actions workflow, **only where none exist**, so running it again is safe. It prints what it did:

```
created   .stack-agent/bin/guard.mjs
created   .stack-agent/bin/verify.mjs
...
created  .stack-agent/guard.config.json
created  .stack-agent/verify.json
created  .github/workflows/stack-agent.yml
updated  .gitignore (+ .stack-agent/evidence/)
```

### 3. Fill in the placeholders

Every value you must decide is marked `EDIT ME`, and `init --check` lists the files that still have one.

| File | What to put in it |
| --- | --- |
| `.stack-agent/verify.json` | The command that runs your tests, and one **check** that runs the real program the way a user would. |
| `.stack-agent/guard.config.json` | Replace the example rule with one real rule your team never wants broken. |
| `.stack-agent/rules.md` | Soft preferences, one per line, with the reason. Add `@.stack-agent/rules.md` to your repo's `CLAUDE.md` so every session loads it. |
| `.stack-agent/rules-table.md` | One line per hard rule, saying why it exists. |
| `.stack-agent/feature-map.md` | The few things a user does and where each lives in the code. |
| `.github/workflows/stack-agent.yml` | The step that installs your dependencies (`npm ci`, `pip install -r requirements.txt`, and so on) and the branch it should run on. |

The smallest `verify.json` that works, for a Node project:

```json
{
  "test": { "command": "npm test", "timeoutSec": 600 },
  "evidenceDir": ".stack-agent/evidence",
  "checks": [
    {
      "name": "smoke",
      "command": "node -e \"import('./src/add.js').then(m => { if (m.add(2, 2) !== 4) process.exit(1) })\"",
      "expectExit": 0,
      "timeoutSec": 120
    }
  ]
}
```

A guard rule is a regex over the files it names, with the message and the fix the agent will be shown:

```json
{
  "id": "no-console-log",
  "type": "pattern",
  "files": ["src/**"],
  "pattern": "console\\.log\\(",
  "message": "use the logger, not console.log",
  "fix": "call log.info(...) from src/log.js"
}
```

For a server, HTTP checks, a database, and the `against` step, see section 1 of [docs/adoption.md](docs/adoption.md).

### 4. Record today's state and check it

```bash
node .stack-agent/bin/guard.mjs --update-baseline
```

```bash
node .stack-agent/bin/verify.mjs
```

```bash
node path/to/Stack_Agent/scripts/init.mjs . --check
```

The first records the violations that already exist, so only new ones fail. The second should end with `verify: ok`. The third should say `setup complete`; until it does, it lists what is left. On a project this size it looks like:

```
PASS tests: npm test (exit 0)
PASS check smoke: node -e "..." -> exit 0
SKIP against: .stack-agent/verify.json does not exist at HEAD
verify: ok, evidence .stack-agent/evidence/verify-2026-10-27T08-58-08-216Z.json
```

(The `SKIP` is normal until the config is committed: `verify.json` is not in git yet, so there is no earlier version to compare with.)

### 5. Commit it, and make CI the gate

Commit `.stack-agent/` (the evidence folder is git-ignored) and the workflow. Then, on GitHub, make the workflow's jobs required checks on your default branch, and add `.github/CODEOWNERS` with a line such as `/.stack-agent/ @your-org/leads` (and one for the workflow) so the rules cannot be loosened without a reviewer. `init` does not write that file because it does not know your team. The `verify` job fails until the install step is filled in; that is deliberate, so a pull request cannot switch the gate off by leaving a placeholder. [docs/adoption.md](docs/adoption.md) has the details, including monorepos.

### 6. See it work

Start a **new** Claude Code session in the project (hooks load when a session starts). Then try the two things that matter:

1. Ask the agent to run `git commit --allow-empty --no-verify -m test`. The hook denies it with:

   ```
   blocked: `git commit --no-verify` skips the repo's guard and checks. Fix what the hook reports instead.
   ```

2. Ask it to change some code and stop. The Stop hook blocks it until a passing verify run matches the code, or the agent records why it cannot verify.

If neither happens, see [Troubleshooting](#troubleshooting).

### Update and remove

```bash
claude plugin update stack-agent@stack-agent-marketplace
```

Restart Claude Code. If the plugin's tools are newer than the copies in `.stack-agent/bin/`, the SessionStart hook says so and prints the exact command; it is the `init.mjs` command from step 2, and it rewrites only the tools, never your config. Commit the result so CI runs the same tools as the hooks.

To remove it: `claude plugin uninstall stack-agent@stack-agent-marketplace`, then delete `.stack-agent/`, the workflow, the `@.stack-agent/rules.md` line in `CLAUDE.md`, and the `.stack-agent/` lines `init` added to `.gitignore` and `.prettierignore`.

### Or fork it

Fork or clone the repo, then change anything: add a preset, a guard rule, a skill, or an eval case. Point your team at your fork with `claude plugin marketplace add <you>/<your-fork>`. See [docs/customizing.md](docs/customizing.md).

## Daily use

1. The agent changes code. The hooks run the guard on each edit, and on the files a shell command changed, and report violations with the fix.
2. Before it finishes, it runs `node .stack-agent/bin/verify.mjs` and reports the evidence file. If it tries to stop without evidence that matches the code, the Stop hook blocks it, up to 3 times in a row, then lets it stop and tells you the change is unverified.
3. CI runs the guard (with `--compare-ref` on pull requests), the API map or feature map check where the project has one, and verify on every push and pull request (with the against step on pull requests).
4. When you correct the agent twice for the same thing, run `/stack-agent:correct` to turn it into a rule.
5. Spot-check recent commits with `/stack-agent:sample-review` instead of reviewing every PR first.

Commands you will use (run from the project's root):

| I want to | Run |
| --- | --- |
| Run everything and write evidence | `node .stack-agent/bin/verify.mjs` |
| Run one check, or only the tests | `node .stack-agent/bin/verify.mjs --check NAME` · `--skip-checks` |
| Find out how often a flaky check fails | `node .stack-agent/bin/verify.mjs --check NAME --repeat 30` |
| Say why verification cannot run (15 characters or more) | `node .stack-agent/bin/verify.mjs --skip "no database in this sandbox"` |
| Check the rules | `node .stack-agent/bin/guard.mjs` |
| Accept today's violations as the baseline | `node .stack-agent/bin/guard.mjs --update-baseline` (a person adds `--allow-increase` to raise it) |
| Fail if the rules were loosened compared with a branch | `node .stack-agent/bin/guard.mjs --compare-ref origin/main` |
| See what setup is still unfinished | `node path/to/Stack_Agent/scripts/init.mjs . --check` |

The full walkthrough, with every option, is in [docs/adoption.md](docs/adoption.md).

## Troubleshooting

- **The hooks do nothing.** Check that the plugin is enabled (`claude plugin list`), that you started a new session after installing it, and that the project has `.stack-agent/verify.json`: the hooks stay out of projects without it.
- **The Stop hook keeps blocking.** Run `node .stack-agent/bin/verify.mjs`, or, if verification truly cannot run, record why with `--skip "<reason>"`. After 3 blocks in a row it lets the agent stop and says the change is unverified; a new message from you resets the count.
- **`guard --update-baseline` refuses.** It will not raise the baseline by itself: a rule you just added now finds old violations, or a new one appeared. If the old ones are accepted, a person reruns it with `--allow-increase`.
- **`init --check` exits 1.** Read the list it prints: placeholders left to fill, a missing baseline, or tools in `.stack-agent/bin/` older than the plugin's (rerun `init` to refresh them).
- **The CI `verify` job fails on `EDIT ME`.** Fill in the install step of the workflow. It fails on purpose until then.
- **`verify` says `FAIL against`.** A new check passes on the old code too, so it does not test the change. Add a check that fails without it.
- **A formatter or linter fails on `.stack-agent/`.** Add the folder to its ignore file (`init` does this for Prettier, and for an `.eslintignore` that already exists). The tools are copied byte for byte, and a reformatted one reads as outdated.

## What you get

| Layer | Where | What it does |
| --- | --- | --- |
| Verification | `scripts/verify.mjs`, skill `verify` | Runs your tests, starts your server if you have one, runs HTTP checks and command checks, and writes evidence to `.stack-agent/evidence/`. |
| Hard constraints (CI) | `scripts/guard.mjs` | Regex rules for any language, plus import rules for JS/TS and Python. A baseline ratchets: existing violations pass, new ones fail. `--compare-ref` fails a PR that loosens the rules. |
| Hard constraints (live) | `hooks/hooks.json` | In projects set up with Stack Agent, blocks hook bypasses (`--no-verify`, `HUSKY=0`, `core.hooksPath`), asks before force-push, deleting or force-moving a branch, `reset --hard`, or edits to the guard's own files. Runs the guard after every edit and on the files each shell command changed. Keeps the agent from stopping until verify evidence matches the code it changed, or it records why it cannot verify. |
| Soft constraints | `.stack-agent/rules.md` | Team preferences loaded into every session. |
| Feature map (backends) | `scripts/api-map.mjs`, skill `api-map` | Drafts an endpoint map from code and fails when the map drifts. |
| Feature map (other presets) | `scripts/feature-map.mjs`, skill `feature-map` | A table of what a user does and where it lives (`path`, `path:line`, or `path#text`); fails when a file, a line, an anchor text, or a named verify check is gone. |
| Skills | `skills/` | `verify`, `stack-agent-init`, `correct`, `reflect`, `sample-review`, `debug`, `run-evals`, `feature-map`, `mine-corrections`, and for backends `add-endpoint`, `add-migration`, `api-map`. |
| Agents | `agents/` | `judge` scores work against a rubric. `reviewer` checks a diff before a human does and reports candidates; `finding-verifier` tries to refute each one. None of them edits files. |
| Evals | `evals/` | `claude plugin eval` cases that compare runs with and without the plugin. |

## Presets

| Preset | For | Verify uses |
| --- | --- | --- |
| `generic` | anything (default) | your test command and one smoke command |
| `backend-http` | APIs and web servers | a server, HTTP checks, and an API map |
| `frontend-web` | web apps | a dev server, a page check, and an e2e command |
| `cli` | command-line tools | command checks for `--help`, the main path, and bad input |
| `library` | packages others import | a build and an example that uses the public API |

Every preset includes two universal guard rules: no merge-conflict markers and no private keys.

## Examples

- [`examples/sample-backend`](examples/sample-backend): a Node HTTP API on `node:sqlite` with modules, a migration runner, an API map, and a deliberate legacy violation that shows the ratchet.
- [`examples/sample-cli`](examples/sample-cli): a Python CLI with command checks and a "core stays pure" guard rule. It shows that the project itself does not need to be Node.
- [`examples/sample-library`](examples/sample-library) (`library` preset): a small Node package whose `build` check loads `dist/` through `package.json` `exports` and whose example imports the package by name, plus a guard rule that keeps examples out of `src/internal/`.
- [`examples/sample-frontend`](examples/sample-frontend) (`frontend-web` preset): a static web app on a `node:http` dev server, with a page check and an `e2e` script that follows every module the page loads, plus the `client-not-import-server` guard rule.
- [`examples/sample-generic`](examples/sample-generic) (`generic` preset): a data job that turns an expenses CSV into per-category totals, with a shell-free `args` smoke check and a "transform stays pure" guard rule.

## Requirements and limits

- Node.js 22 or newer, only to run the tools. The project can use any language.
- `forbidden-import` and `module-boundary` rules read JS/TS and Python imports. Use `pattern` rules for other languages.
- The hooks match command patterns. They catch common shortcuts, not every possible one. CI is the gate that always holds.
- `claude plugin eval` needs Claude Code 2.1.269 or newer. Cases that let the agent use Bash need Linux, macOS, or WSL2, because native Windows has no sandbox for them.
- Tested on Windows 11 with Node 26. CI runs the tests and all five examples on Linux and Windows with Node 22 and 24.
- The hooks have been run for real against Claude Code 2.1.299 to 2.1.310. Claude Code changes often; if a hook stops firing after an update, [open an issue](https://github.com/Brown248/Stack_Agent/issues).

## Developing Stack Agent

```bash
npm test
```

```bash
claude plugin validate . --strict
```

Rules for working on this repo are in [.claude/CLAUDE.md](.claude/CLAUDE.md).

## License

[MIT](LICENSE)
