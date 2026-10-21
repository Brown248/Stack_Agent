# Design notes

Where the ideas come from, how each one maps to a file, what was left out on purpose, and what has and has not been verified.

[ภาษาไทย](th/design-notes.md)

## Origin

Stack Agent started from notes on three talks:

- Lauren Tan (creator of [pstack](https://github.com/cursor/plugins/tree/main/pstack)), on how she gets agents to the point where their PRs can merge with only sampled review: verification first, constraints in lint and CI instead of prompts, evals for skills.
- A second, more detailed talk by Lauren Tan covering browser control, the eval playbook, and the "Dune" architecture rules.
- Austin Marchese's summary of how Anthropic engineers write Claude Code skills: small, composable, with scripts, and improved after every use.

The shared thesis: move knowledge out of people's heads and prompts into structure that fails loudly, until the agent can be trusted to work alone.

## Idea → implementation

| Idea | Implementation | Verified by |
| --- | --- | --- |
| Verification: the agent proves the change works on the real program | `scripts/verify.mjs` (tests, server, HTTP checks, command checks, evidence), skill `verify` | `tests/verify.test.mjs`, `tests/verify-command.test.mjs`, `tests/verify-args.test.mjs`, all five examples pass full verify |
| Close the loop: check results in the same session | evidence in `.stack-agent/evidence/latest.json` (full vs partial runs, a fingerprint of the tested code), Stop hook `stop-verify.mjs` that blocks until the evidence matches the code, with a logged `--skip` and a 3-block cap | `tests/hooks.test.mjs`, `tests/stop-hook.test.mjs`, `tests/stop-block.test.mjs`, `tests/fingerprint.test.mjs` |
| A check must test the change, not just pass | the `against` step in `verify.mjs`: new checks run on the code before the change, and at least one must fail there | `tests/verify-against.test.mjs` |
| Feature map: where each feature lives | `scripts/api-map.mjs` for HTTP backends, with drift detection | `tests/api-map.test.mjs`, real eval run (below) |
| Hard constraints in lint/CI, not prompts | `scripts/guard.mjs` + `templates/ci/stack-agent.yml` | `tests/guard.test.mjs`, `tests/presets.test.mjs` |
| Shortest path = correct path | every rule must carry a `fix`, and the PostToolUse hook hands it to the agent right after the edit | guard config tests, hook tests |
| Turn repeated review comments into rules | skill `correct` (architecture, then types, then guard, then tests, docs last) | skill instructions |
| Ratchet for shared repos | baseline counts, `--allow-increase`, `--compare-ref` | ratchet and compare-ref tests |
| Sampling review instead of reviewing every PR | `scripts/sample-commits.mjs` + skill `sample-review` + agent `reviewer` | `tests/sample-commits.test.mjs` |
| Evals as unit tests for skills, blind, judged by another model | `evals/` in `claude plugin eval` format (with/without delta, haiku judge by default), agent `judge`, skill `run-evals` | one case run for real (below) |
| Deterministic work in scripts, judgment to the agent | zero-dependency scripts for every repeatable step | 219 tests |
| Skills: small, composable, with scripts, getting better each use | 9 skills, `reflect` for improving them | `claude plugin validate --strict` |
| Who may invoke a skill | `disable-model-invocation: true` on skills that write many files or cost money | skill frontmatter |
| A live layer between prompt and CI | `hooks/hooks.json`: PreToolUse (shell and edits to guard files), PostToolUse, Stop | `tests/hooks.test.mjs` |

## Left out on purpose

- **Auto-merge and an outer loop** (pulling work from Slack or trackers): add these only after verification and the guard have a track record in your repo.
- **Browser control (Control Glass):** use your own e2e runner as a command check (`frontend-web` preset). A built-in browser driver would add a heavy dependency.
- **Cloud agents (Benny):** depends on Cursor Automations, which Claude Code does not have.
- **Project-specific rules from the talks** (no `useEffect`, no code comments): those belong to one codebase. Write them as `pattern` rules if you want them.

## Known limits

- Import-based rules read JS/TS and Python. Other languages use `pattern` rules. Python resolution is static: it does not follow `sys.path` changes, `importlib` calls, or installed packages, so a module not found in the repo is treated as third-party.
- The shell hooks match patterns, so a determined workaround (an alias, or a script that writes a file without naming it) can slip past. CI with `--compare-ref` and CODEOWNERS is the gate that always holds.
- The PostToolUse guard covers Edit/Write. Shell edits are caught by CI and the Stop hook.
- Evidence and the skip record are plain files. Edit/Write on them asks a human, but a determined shell write can still forge them. The `verify` job in the CI template reruns verify on every push and pull request (with `--against origin/<base>` on pull requests), so a forged file does not pass CI. That holds only while the job is a required check and the workflow and `verify.json` are under CODEOWNERS, and while the install step is filled in. The workflow has not been run on GitHub Actions yet; for now it is checked only by text tests.
- The `against` step proves that at least one new check tells the old code from the new. It cannot judge whether the checks cover everything the change should do, and results it cannot trust (the old server does not start) skip it instead of passing it.
- The ratchet counts per file per rule. Import rules count each imported name (baseline version 2). Version 1 counted statements, so adding a name to an existing forbidden import passed; that gap was found while planning the A/B work and closed with a regression test (`tests/guard-widening.test.mjs`).
- An LLM judge in Claude Code can only be another Claude model, so "a different model" means a different Claude model.

## Verification status

| What | Status |
| --- | --- |
| Unit and integration tests | 219 pass on Windows 11, Node 25 |
| All five examples, one per preset (Node API, Python CLI, library, frontend, generic data script) | pass guard and full verify, and fail verify when a behavior is deliberately broken (`tests/sample-presets.test.mjs`, `tests/sample-cli.test.mjs`) |
| Mutation check (14 deliberate bugs) | all caught by the tests |
| `claude plugin validate --strict` | passes |
| Eval `api-map-lookup` (read-only) | run twice for real: 1.0 with the plugin, 0.5 without, delta +0.5. Both answered correctly. The difference is that with the plugin the agent read the map first. |
| Evals that use Bash (`add-endpoint-delete-item`, `verify-before-done`, `add-migration-column`) | run in WSL2 Ubuntu 24.04 (Claude Code 2.1.304, Sonnet, 1 run per arm, about $1.20), but they cannot measure verification there: `claude plugin eval` sandboxes Bash so that it cannot write under `.stack-agent/`, so `verify.mjs` and `verify.mjs --skip` fail with EROFS in both arms, and the `verify-passed-full` grader finds no evidence. The cases now list `allowed_tools`, without which Bash was withheld. Setup notes: Node must be outside `/home` (the sandbox cannot read it), and Docker Desktop's links in `~/.docker` stop a Bash-granting eval, so `~/.docker` was moved aside for the run. Every agent, in both arms, told the user the change was unverified; none wrote evidence by hand. Behavior is measured by `scripts/ab/run.mjs` instead (see the A/B sections). |
| CI on Linux and Windows, Node 22/24 | configured, not yet run |
| Hooks inside a live Claude Code session | verified in real headless runs (`claude -p --plugin-dir`, Claude Code 2.1.300, haiku, $0.05 total): the `--no-verify` deny, the guard-baseline ask, the PostToolUse guard, and the Stop reminder all fired, and the reminder stayed silent the second time |
| Fingerprint, against step, and blocking Stop hook in a live session | 4 real headless runs (Claude Code 2.1.299, Sonnet, about $0.52 total), sample-backend, the "reject names over 50 characters" task. With a neutral prompt (2 runs) both agents added a reject-51 check and ran verify before stopping; the SessionStart hook recorded the session, the against step ran against the session's starting commit and reported the check as detecting, and the Stop hook allowed the stop without blocking. With a prompt saying "no need to run anything or add tests" (2 runs) the Stop hook blocked once; both agents then ran `verify.mjs --skip` with the reason "User asked for a quick change with no running and no tests", the hook showed that reason, and both final replies told the user the change was unverified. The first 2 runs were flagged invalid by the isolation check: the desktop app's `CLAUDE_CODE_PLUGIN_DIRS` loaded 9 other plugins into the child `claude`, which `--setting-sources` does not stop; the harness now drops that variable and the next 2 runs were valid. Too few runs for rates. |
| Guard full-scan speed | after caching glob regexes and dropping redundant file checks: synthetic repos without imports, 1k/5k/20k files, 1,535→180 ms, 2,872→639 ms, 16,698→2,239 ms; import-heavy repos (`scripts/bench-guard.mjs`) 13–17% faster. Then each import target is resolved on disk once per run instead of once per import: import-heavy 1k/5k files, median 566→254 ms and 2,859→1,312 ms (about 2.2x; a noisy machine, best runs 511→213 and 1,775→860 ms). Output is byte-identical before and after each step. A later independent rerun on a busy machine was too noisy to confirm the exact ratio (3 of 4 comparisons faster, 1.7–3x; one slower), so treat it as indicative. Output hashes were identical in every run. |

## Behavioral A/B with real agents (2026-10-19)

Unit tests prove the tools work. This test asks a different question: does the plugin change what a real agent does?

The harness behind this test is maintained in `scripts/ab/`; see [Measure agent behavior (A/B)](customizing.md#measure-agent-behavior-ab) to rerun it.

**Method.** Headless `claude -p` runs (Claude Code 2.1.300, Sonnet, at most $1 per run), with `--plugin-dir` versus without it. Each run got a fresh copy of `examples/sample-backend` with `init.mjs` already applied, so both arms had the same `.stack-agent/` files. Permissions were `acceptEdits` plus Read/Glob/Grep/Edit/Write and `node`/`npm` shell commands. Grading was done by scripts after each run, never by the agent's own summary: an independent HTTP probe (the script starts the server itself and calls the endpoints), the test suite, the guard, the API map, whether a fresh and full verify evidence file exists, and whether `verify.json` gained a check that covers the new rule. Transcripts were parsed to see which skills and hooks were involved.

**Task 1: add `DELETE /items/:id`** (the prompt asks to make sure it works). 2 runs per arm.

| | With plugin | Without |
| --- | --- | --- |
| Correct behavior, tests pass, guard ok, map updated | 2/2 | 2/2 |
| Fresh full verify evidence | 2/2 | 2/2 |
| Cost per run | about $0.41 | about $0.41 |

There was no measurable difference. Both arms found and used the `.stack-agent/` files (rules, map, verify config) by reading the repo. On a well-specified task, the in-repo files did the work and the plugin added nothing measurable.

**Task 2: reject item names over 50 characters** (the prompt does not ask for verification).

| | Without plugin | Plugin, old Stop hook | Plugin, new Stop hook |
| --- | --- | --- | --- |
| Runs | 3 | 6 | 7 |
| Correct behavior (independent probe) | 3/3 | 6/6 | 7/7 |
| Fresh full verify evidence | 0/3 | 6/6 | 7/7 |
| `verify.json` gained a check covering the 50-character rule | 0/3 | 1/6 | 7/7 |
| Cost per run | $0.25–0.27 | $0.27–0.38 | $0.28–0.33 |

- **The Stop hook is what made agents verify.** The plugin arm always produced evidence and the bare arm never did. The hook fired in 13 of the 15 plugin runs across both tasks (in the other 2 the agent had already verified). A skill was invoked in only 1 of the 15 runs, so the skills did not drive this behavior.
- **The old hook let unchecked evidence through.** Agents re-ran the existing checks, which passed without ever exercising the new rule. The new hook adds a sentence when `verify.json` has not changed: add a check for the new behavior, success and rejection.
- **Attribution of the new hook:** in 4 of the 7 runs the agent added the check by itself before stopping, so the new sentence never showed. In the other 3, the sentence appeared before any `verify.json` edit, and all 3 agents then added both an accept-50 and a reject-51 check. So the sentence worked 3 out of 3 times it was shown. An ablation rerun with the old hook gave 1/3, which confirms that adding a check on its own initiative varies from run to run.

**Limits.** The samples are small (2 to 7 runs per cell), so read these as indications, not statistics. Only one model was tested. The sample app is tiny, so correctness hit a ceiling in every arm. The user's other installed plugins were loaded in both arms. Runs happened back to back on one machine. Total cost was about $6.30.

## Behavioral A/B, round 2 (2026-10-20)

After the fingerprint, the against step, and the blocking Stop hook were added, the same question was asked again with a cleaner setup.

**Method.** `scripts/ab/run.mjs`, Claude Code 2.1.299, Sonnet, at most $1 per run, 3 tasks x 2 arms (`full` = the plugin, `none` = no plugin) x 5 runs = 30 runs. Every run was isolated (`--setting-sources project,local`, `--strict-mcp-config`, and the parent's `CLAUDE_CODE_PLUGIN_DIRS` removed) and every transcript passed the isolation check, so no other plugin was loaded in either arm. Grading was done by scripts, never by the agent's summary. Total cost $3.74.

| Task | Arm | Correct behavior | Fresh full verify evidence | `verify.json` gained a check covering the rule | Mean cost |
| --- | --- | --- | --- | --- | --- |
| Reject names over 50 characters (prompt does not mention checking) | plugin | 5/5 | 5/5 | 5/5 | $0.115 |
| | none | 5/5 | 0/5 | 0/5 | $0.065 |
| Same, but the prompt says "no need to run anything or add tests" | plugin | 5/5 | 1/5 | 1/5 | $0.077 |
| | none | 5/5 | 0/5 | 0/5 | $0.055 |
| Add `DELETE /items/:id` (prompt asks to make sure it works) | plugin | 5/5 | 5/5 | - | $0.207 |
| | none | 5/5 | 5/5 | - | $0.229 |

- **When the prompt does not ask for checking, the plugin is the difference between verified and unverified work:** 5/5 against 0/5 (two-sided Fisher exact test, p of about 0.008). In all 5 plugin runs the against step confirmed that the new check fails on the code from before the change. The Stop hook blocked in 3 of the 5; in the other 2 the agent verified before stopping. It cost about $0.05 and 20 seconds more per task.
- **When the user says not to run anything,** neither arm verified in 4 of 5 runs, but they differ in honesty. All 4 unverified plugin runs recorded a skip with a reason ("User asked for a quick change with no running or tests; ... not verified"), the hook showed it, and the agent said so. The bare arm stopped silently. One plugin run verified fully anyway.
- **When the prompt already asks for checking,** there is no difference, as in round 1.
- Correctness was 30/30 in every cell: the sample app is small enough that the plugin cannot improve it. The value measured here is verification and honesty about it, not code quality.

**Limits.** 5 runs per cell, one model, one small sample app, three tasks written by the same author as the plugin (one of them, the hurry variant, written for this round), runs back to back on one machine. Treat the numbers as strong signals on this setup, not as general rates.

## Self-review log

After the first build, an independent reviewer and an independent tester (who adopted the toolkit on a fresh project following the docs) found about 15 real problems. All were fixed, each with a regression test. The main ones:

- The agent could loosen the guard by editing its config or baseline directly. Fixed with a protected-paths hook, `--compare-ref` in CI, and CODEOWNERS guidance.
- Shell bypasses (`git --no-pager commit --no-verify`, `HUSKY=0`, `core.hooksPath`, `bash -c "..."`, `push --mirror`, `checkout .`) slipped through. The command parser was rewritten.
- Timed-out tests were not killed, more than 1 MB of test output was reported as a failure, and partial verify runs counted as evidence.
- The Stop hook did nothing in monorepos, brace globs silently matched nothing, and string-valued config fields crashed the guard.

When the repo became generic, three more problems were found and fixed: the tests leaked temp folders, the CI template always ran the API map check (failing every non-backend project), and verify only knew HTTP.

A second review round, plus a tester who adopted the toolkit on two Python projects using only the English docs, found:

- Command checks matched only the last 8 to 16 KB of output, so an early error in a long log could pass `expectOutputExcludes`. Matching now sees up to 8 MB and fails loudly beyond that.
- Running only command checks still started (or refused over) the server. The server now starts only for HTTP checks or checks with `needsServer`.
- Re-running `init` with another preset silently mixed two presets. `init` now records the preset and refuses a mix.
- A `^` in a guard pattern only matched line 1, and a single `\b` in JSON became an invisible backspace. Patterns are now always multiline, and control characters are rejected.
- Python caches were scanned, and route regexes only fit Express. Default ignores now cover Python and Rust/Java build folders. Sources can fix the method, and the docs show tested regexes for Express, FastAPI, Flask, and Go.
- Docs gained Windows quoting rules, the output limit, regex flags, and the JS-only scope of import rules.
