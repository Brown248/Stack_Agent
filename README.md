# Stack Agent

A Claude Code plugin and template that turns your team's know-how into structure an AI agent cannot skip: verification with evidence, guard rules that ratchet, hooks that stop shortcuts, small skills with scripts, a blind judge, and evals that measure whether any of it helps.

It works for any kind of project. Presets cover HTTP backends, web frontends, CLIs, and libraries, and the core works for anything you can test with a command. Install it as a plugin, or fork it and make it yours.

[ภาษาไทย](README.th.md)

## Why

AI agents write code fast, but three things keep you watching every line:

- They say "it should work" without running anything.
- They take the shortest path that compiles, and the structure rots.
- They repeat mistakes, because a rule in a prompt is easy to forget.

Stack Agent moves rules out of prompts and into things that fail loudly: a verify run that must pass, a guard that fails CI, and hooks that stop the agent at the moment it reaches for a shortcut. The ideas come from Lauren Tan's talks on pstack and from how Anthropic engineers build Claude Code skills. See [docs/design-notes.md](docs/design-notes.md).

## What you get

| Layer | Where | What it does |
| --- | --- | --- |
| Verification | `scripts/verify.mjs`, skill `verify` | Runs your tests, starts your server if you have one, runs HTTP checks and command checks, and writes evidence to `.stack-agent/evidence/`. |
| Hard constraints (CI) | `scripts/guard.mjs` | Regex rules for any language, plus import rules for JS/TS and Python. A baseline ratchets: existing violations pass, new ones fail. `--compare-ref` fails a PR that loosens the rules. |
| Hard constraints (live) | `hooks/hooks.json` | In projects set up with Stack Agent, blocks hook bypasses (`--no-verify`, `HUSKY=0`, `core.hooksPath`), asks before force-push, deleting or force-moving a branch, `reset --hard`, or edits to the guard's own files. Runs the guard after every edit. Keeps the agent from stopping until verify evidence matches the code it changed, or it records why it cannot verify. |
| Soft constraints | `.stack-agent/rules.md` | Team preferences loaded into every session. |
| Feature map (backends) | `scripts/api-map.mjs`, skill `api-map` | Drafts an endpoint map from code and fails when the map drifts. |
| Skills | `skills/` | `verify`, `stack-agent-init`, `correct`, `reflect`, `sample-review`, `debug`, `run-evals`, and for backends `add-endpoint`, `add-migration`, `api-map`. |
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

## Quick start

### Use it as a plugin

```bash
claude plugin marketplace add Brown248/Stack_Agent
```

```bash
claude plugin install stack-agent@stack-agent-marketplace
```

Then, in Claude Code inside your project, run `/stack-agent:stack-agent-init`. It picks a preset with you, fills in the config, and runs each check until it passes.

Or set it up by hand from a clone:

```bash
node path/to/Stack_Agent/scripts/init.mjs . --preset cli
```

`init.mjs` copies the tools into `.stack-agent/bin/` so CI runs them without the plugin. It adds config templates and a GitHub Actions workflow only where none exist. Re-running it is safe. `--check` reports what is still unfinished.

### Fork it

Fork or clone the repo, then change anything: add a preset, a guard rule, a skill, or an eval case. Point your team at your fork with `claude plugin marketplace add <you>/<your-fork>`. See [docs/customizing.md](docs/customizing.md).

## Daily use

1. The agent changes code. The hook runs the guard on each edit and reports violations with the fix.
2. Before it finishes, it runs `node .stack-agent/bin/verify.mjs` and reports the evidence file. If it tries to stop without evidence that matches the code, the Stop hook blocks it, up to 3 times in a row, then lets it stop and tells you the change is unverified.
3. CI runs the guard and `--compare-ref` on every pull request, plus the API map check in projects that have one.
4. When you correct the agent twice for the same thing, run `/stack-agent:correct` to turn it into a rule.
5. Spot-check recent commits with `/stack-agent:sample-review` instead of reviewing every PR first.

The full setup walkthrough is in [docs/adoption.md](docs/adoption.md).

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
