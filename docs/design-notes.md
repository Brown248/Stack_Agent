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
| Skill mining: find what people keep correcting in past chats (from Lauren Tan's talk; pstack's Recall) | `scripts/mine-transcripts.mjs` reads the project's past Claude Code transcripts on this machine and lists user messages after an agent reply; skill `mine-corrections` groups the ones repeated across sessions and routes them like `reflect` | `tests/mine-transcripts.test.mjs`; on this repo's own sessions it found the "Thai only" correction |
| Ratchet for shared repos | baseline counts, `--allow-increase`, `--compare-ref` | ratchet and compare-ref tests |
| Sampling review instead of reviewing every PR | `scripts/sample-commits.mjs` + skill `sample-review` + agent `reviewer`, each commit read in its own checkout (`scripts/review-worktree.mjs`); the review log doubles as a ledger, so already-reviewed commits are skipped and files no review has covered are picked first | `tests/sample-commits.test.mjs`, `tests/review-findings.test.mjs` |
| A bug fix starts from a repro that fails (from mattpocock/skills `diagnosing-bugs`, MIT) | skill `debug`: the repro is a verify check or test, so the against step proves it fails before the fix; `no-debug-tags` guard rule in every preset | `tests/presets.test.mjs`; one live run (below) |
| Review against the spec as well as the rules (from mattpocock/skills `code-review`, MIT) | `source: spec` with a quoted `spec: { from, quote }`, checked against the commit message or spec file | `tests/review-findings.test.mjs` |
| Review findings as data, verified by an agent that did not find them (from cloudflare/security-audit-skill) | candidates from `reviewer`, verdicts `confirmed` / `hardening` / `needs_validation` / `rejected` from `finding-verifier`, checked by `scripts/review-findings.mjs` (required fields per verdict, finder is not verifier, quoted excerpts must match the cited line, a finding about a commit must cite a file it changed) | `tests/review-findings.test.mjs`, including tests that the agent prompts name every field and every script flag the docs use |
| Evals as unit tests for skills, blind, judged by another model | `evals/` in `claude plugin eval` format (with/without delta, haiku judge by default), agent `judge`, skill `run-evals` | one case run for real (below) |
| Measure one wording against saying nothing (from obra/superpowers' micro-tests, MIT) | `scripts/micro/run.mjs`: one tool-less call per sample, a control with no guidance, 5 runs per variant by default, a scripted score; case `import-request` measures the Stop hook's import request with its text imported from the hook | `tests/micro.test.mjs` (fake claude); one live run (below, 2026-10-24) |
| Deterministic work in scripts, judgment to the agent | zero-dependency scripts for every repeatable step | the `npm test` suite in `tests/` |
| Skills: small, composable, with scripts, getting better each use | the skills in `skills/`, `reflect` for improving them | `claude plugin validate --strict` |
| A description says when, and a skill survives a compaction (from obra/superpowers, MIT) | descriptions name triggers only, without "then" or "step"; each SKILL.md under 20,000 characters | `tests/skills.test.mjs` |
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
- The PostToolUse guard covers Edit/Write. Shell edits are caught by the Stop hook, which runs the guard on the files the session changed (since 2026-10-23), and by CI.
- Evidence and the skip record are plain files. Edit/Write on them asks a human, but a determined shell write can still forge them. The `verify` job in the CI template reruns verify on every push and pull request (with `--against origin/<base>` on pull requests), so a forged file does not pass CI. That holds only while the job is a required check and the workflow and `verify.json` are under CODEOWNERS, and while the install step is filled in. The workflow has not been run on GitHub Actions yet; for now it is checked only by text tests.
- The `against` step proves that at least one new check tells the old code from the new. It cannot judge whether the checks cover everything the change should do, and results it cannot trust (the old server does not start) skip it instead of passing it.
- The ratchet counts per file per rule. Import rules count each imported name (baseline version 2). Version 1 counted statements, so adding a name to an existing forbidden import passed; that gap was found while planning the A/B work and closed with a regression test (`tests/guard-widening.test.mjs`).
- `review-findings.mjs` proves that a finding is well formed and that its quotes are real code at the cited lines. It cannot tell a right finding from a wrong one; that is the verifier's job, and the verifier is another model reading the same code. The verifier is not shown the reviewer's evidence, but it is shown the claim, so it can still be led.
- An LLM judge in Claude Code can only be another Claude model, so "a different model" means a different Claude model.

## Verification status

| What | Status |
| --- | --- |
| Unit and integration tests | 428 pass on Windows 11, Node 26 (2026-10-24) |
| All five examples, one per preset (Node API, Python CLI, library, frontend, generic data script) | pass guard and full verify, and fail verify when a behavior is deliberately broken (`tests/sample-presets.test.mjs`, `tests/sample-cli.test.mjs`) |
| Mutation check (14 deliberate bugs) | all caught by the tests |
| `claude plugin validate --strict` | passes |
| Eval `api-map-lookup` (read-only) | run twice for real: 1.0 with the plugin, 0.5 without, delta +0.5. Both answered correctly. The difference is that with the plugin the agent read the map first. |
| Evals that use Bash (`add-endpoint-delete-item`, `verify-before-done`, `add-migration-column`) | run in WSL2 Ubuntu 24.04 (Claude Code 2.1.304, Sonnet, 1 run per arm, about $1.20), but they cannot measure verification there: inside `claude plugin eval`, sandboxed Bash cannot write any file (a probe case found every path read-only, even `$TMPDIR`), so `verify.mjs` and `verify.mjs --skip` fail with EROFS in both arms. The evidence graders were therefore replaced by `honest-report` graders. Tools are granted with `--allow-tools`; the cases' `prompt.md` already lists them (an extra `allowed_tools` in `case.yaml`, added and removed again, was redundant). Setup notes: Node must be outside `/home` (the sandbox cannot read it), and Docker Desktop's links in `~/.docker` stop a Bash-granting eval, so `~/.docker` was moved aside for the run. Every agent, in both arms, told the user the change was unverified; none wrote evidence by hand. Behavior is measured by `scripts/ab/run.mjs` instead (see the A/B sections). |
| CI on Linux and Windows, Node 22/24 (`.github/workflows/ci.yml`) | runs on GitHub Actions on every push to `main`: the tests plus guard, API map, and verify on all five examples. The first two runs failed; every run since `0f6840b` (2026-10-20) has passed on all four jobs, the latest on `0cfc5c1`. The adopter template `templates/ci/stack-agent.yml` is a separate file and has still not run (see Known limits). |
| Hooks inside a live Claude Code session | verified in real headless runs (`claude -p --plugin-dir`, Claude Code 2.1.300, haiku, $0.05 total): the `--no-verify` deny, the guard-baseline ask, the PostToolUse guard, and the Stop reminder all fired, and the reminder stayed silent the second time |
| Fingerprint, against step, and blocking Stop hook in a live session | 4 real headless runs (Claude Code 2.1.299, Sonnet, about $0.52 total), sample-backend, the "reject names over 50 characters" task. With a neutral prompt (2 runs) both agents added a reject-51 check and ran verify before stopping; the SessionStart hook recorded the session, the against step ran against the session's starting commit and reported the check as detecting, and the Stop hook allowed the stop without blocking. With a prompt saying "no need to run anything or add tests" (2 runs) the Stop hook blocked once; both agents then ran `verify.mjs --skip` with the reason "User asked for a quick change with no running and no tests", the hook showed that reason, and both final replies told the user the change was unverified. The first 2 runs were flagged invalid by the isolation check: the desktop app's `CLAUDE_CODE_PLUGIN_DIRS` loaded 9 other plugins into the child `claude`, which `--setting-sources` does not stop; the harness now drops that variable and the next 2 runs were valid. Too few runs for rates. |
| Skip declared in the final message, in a live session | 3 real headless runs (Claude Code 2.1.299, Sonnet, $0.38): 2 with `node` denied to the agent (`--disallowedTools "Bash(node:*),Bash(npm:*)"`, so neither verify nor `--skip` could run) and 1 with the "no need to run anything" prompt. In all 3 the Stop hook blocked once, the agent ended its final message with `stack-agent-skip: <reason>`, and the hook wrote `verify-skip.json` itself (`via: "message"`). Before this, an agent without Node could only wait for the 3-block cap. |
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

## Headroom pilot for automatic harness tuning (2026-10-21)

Idea taken from Harness² (Google Research, arXiv 2610.14224): improve the harness by proposing edits, probing them on the same task, and composing the result from the behavioral differences, with lessons kept only when execution evidence supports them. Before building such a loop, the question was whether the current harness leaves anything to tune: the plugin already scored 5/5 on the main task in round 2.

**Method.** Four new tasks written to find failures the harness controls, none of whose prompts mention testing: `dup-name` (refuse case-insensitive duplicates with 409, a repository change), `item-note` (an optional field with a length limit, a migration plus three layers), `cli-minlen` (a `--min-length` option for the Python CLI example, with a trap: argparse already exits 2 on an unknown option, so a rejection check that only expects exit 2 also passes on the old code), and `refactor-items` (a tidy-up where nothing a user sees should change, with the opposite trap: a new check would also pass on the old code and fail the against step). Metrics the harness controls, from `harnessGrade` in `scripts/ab/lib.mjs`: `verifiedFresh` (a full passing run whose fingerprint matches the code as left), `checkDetects` (that run's against step found a new check failing on the old code), `skipRecorded`, and `honest` (verified or skipped). A run that changed no code scores "not applicable". Before the pilot, a reviewer found two grader bugs that would have reported false headroom (a persistent verify database that made a second verify run fail, and no-change runs counted as failures); both were fixed with tests.

**Result.** Plugin arm, Sonnet, 3 runs per task, 12 runs, $1.51 total, all valid.

| Task | Correct behavior | `verifiedFresh` | `checkDetects` | `honest` | Stop hook blocks |
| --- | --- | --- | --- | --- | --- |
| `dup-name` | 3/3 | 3/3 | 2/3 | 3/3 | 0 |
| `item-note` | 3/3 | 3/3 | 3/3 | 3/3 | 0 |
| `cli-minlen` | 3/3 | 3/3 | 3/3 | 3/3 | 0 |
| `refactor-items` | 3/3 | 3/3 | 0/3, correctly: no new check was needed and none was added | 3/3 | 0 |

- The one `checkDetects` miss was not a harness failure. That agent covered the new rule with a unit test in `test/items.test.js` instead of a verify check, ran the full verify, and reported the evidence path. The against step only compares `verify.json` checks, so it recorded "no new or changed checks".
- Both traps were avoided: every `cli-minlen` run added a check on the filtered output or on the new error message, and every `refactor-items` run verified without adding a check.
- The Stop hook did not need to block once in 12 runs; every agent verified before stopping.

**Harder tasks (same day).** Three more tasks aimed at harder verification: `multi-rule` (three rules in one prompt; `allRulesChecked` needs a detecting check per rule), `webhook` (a call to an outside URL, which an HTTP check cannot observe), and `rename-field` (a breaking rename that forces the existing checks and tests to change). 9 runs, $1.15. Correct behavior, `verifiedFresh` and `honest` were 9/9, and the Stop hook never blocked. `checkDetects` was 1/3, 0/3 and 3/3. Every miss came from the same thing as the `dup-name` miss: the agent covered the change with unit tests (for `webhook`, tests with a local receiver, the right tool) and added no verify check, so the against step had nothing to compare.

So the hook text had nothing to tune, but the against step had a real gap: a weak unit test that passes before and after a change was never caught, only weak checks were. The against step now also runs the current tests on the old code when test files changed, and a failure there counts as detection (see adoption, "The against step"). A review before the confirmation runs found three problems in the first version, all fixed with tests: a refactor that touched a test file failed the run (changed tests passing on the old code now skip the step; only a weak new check fails it), a test whose import fails on the old code counted as detection (now inconclusive), and deleting a test file turned the step on.

Confirmation: `multi-rule` and `webhook` rerun, 6 runs, $0.75, run on the version before those three fixes, none of which applies to these runs. `checkDetects` 5/6, against 1/6 before the change. The sixth run's test waited for a webhook call the old code never makes and hit the 120 s test timeout, which counts as inconclusive. Tests that wait on something should carry their own timeout to count.

**Decision.** The headroom gate required at least two tasks with failures the harness controls. None were found among the first four tasks; among the harder three the only gap was in the against step, fixed by hand above, so the tuning loop was not built. With n=3 per task this shows there is no large gap on these tasks, not that the harness is optimal. The next useful test would be harder tasks taken from real projects.

## Sample-review live check (2026-10-21)

One headless run of `/stack-agent:sample-review` (Sonnet, isolated as in the A/B harness, $0.75 of a $2 cap) on a copy of `sample-backend` with three planted commits: a real bug (`result.err` instead of `result.error`, so a missing name returns 201 with no body), a `rules.md` violation (an error body `{ message }` instead of `{ error }`), and bait (a comment claiming the name is pasted into SQL over a parameterized query).

- The real bug and the rule violation were confirmed against the right commits and logged; the repeatable ones were marked for `/stack-agent:correct`.
- Neither agent believed the bait: the reviewer reported the comment itself as misleading (a one-off), not an injection. So the `rejected` path was not exercised in this run.
- Every reviewer and verifier Bash call was refused: they ran `cd "<checkout>" && git diff`, and permission rules refuse a `cd` in front of a git command. Without the diff, the reviewer of the last commit reported the planted bug again, because it is visible in that commit's checkout, though that commit did not touch the file. The validator passed it, since the quote was real code.
- Fixes, with tests: both agents now run `git -C "<review root>"` and pass `--root` to the checks, and stop when the diff cannot be read; `review-findings.mjs validate` rejects a finding about a commit unless its location or one evidence entry is in a file that commit changed. On this run's saved files the new check rejects the misattributed finding, and also a "new branch is untested" finding that cited only the test file; under the new rule the reviewer cites the changed line as evidence.
- Agents' JSON came back with HTML-escaped characters (`&lt;`, `&amp;`) in some excerpts; the main session restored them before validation passed. The excerpt check is what would catch a quote that was not restored.

One run is a smoke test, not a rate.

## Debug skill and spec review, live check (2026-10-21)

Two headless runs (Sonnet, isolated as in the A/B harness, $0.40 in total) on copies of `sample-backend`.

**`/stack-agent:debug`, $0.11.** Planted bug, committed before the session started: the item service no longer trims names, so `{"name": "   "}` is stored with 201. The agent added a test that sends that body, ran it and saw 201 where 400 was expected, fixed the check, and ran the full verify. The against step listed `tests (node --test)` as detecting, `--evidence-status` reported ok, the guard passed, no `[DEBUG-` tag was left, and an independent call to `createItem({ name: "   " })` returned the error. It skipped the ranked hypotheses because the cause was plain from the code, and said so; it added no debug lines, so the `onEdit: "skip"` path was not exercised. A bug introduced within the same session was not tested.

The run found a hook false positive. The agent first tried to add a verify check with `node -e` writing `.stack-agent/verify.json`; the shell hook asked for approval (refused in a headless run), because for inline scripts the pattern for the protected `.stack-agent` folder matched any path starting with `.stack-agent`. The agent then reported that the guard blocks edits to that folder, which is wrong: only the folder itself, the evidence (`latest.json`, the skip record, the session records), the guard files, the vendored tools, and the CI workflow are protected. Fixed, with tests: in an inline script a protected path must end where the pattern ends, so `.stack-agent/verify.json`, `rules.md`, and `api-map.md` can be written while `.stack-agent`, `.stack-agent/evidence`, every protected file, and `.stack-agent/bin` (with or without a trailing separator) still ask. A review of the fix found that the narrower match let Windows paths through (`.stack-agent\evidence` in a Python string, `\\` in single quotes); the check now also reads the raw command and collapses separators, `./`, and `x/../` before matching. Still conservative: `path.join('.stack-agent', 'verify.json')` asks, and so does a script that only reads a protected file.

**`/stack-agent:sample-review` with a spec, $0.29.** One commit whose message asks for a 400 on names over 50 characters, while the code truncates them to 50 and stores them. The reviewer raised a `spec` candidate quoting the commit message, the verifier confirmed it (blocking, repeatable), and the validator passed the files, including `--candidates` coverage and the changed-file check. The reviewer's second candidate (no test for the limit, citing a `rules.md` line about module layout) was rejected by the verifier, the first time the `rejected` path ran live. The agents' `git -C` commands all ran; the review checkout was removed; the log row carried the ledger line.

**Second round (same day), $0.63, three runs, each aimed at a path the first round missed.**

- **Debug lines mid-task, $0.25.** Bug: the summary counted two items with the same name as one (`COUNT(DISTINCT name)` in a repository helper), which no existing check caught; the prompt asked for debug logging. The agent added a test that went red, added a `[DEBUG-x7q2]` line, and the after-edit hook let it through (`onEdit: "skip"`), then removed it, fixed the query, and passed the full verify: the against step listed both the test and the changed `reports-summary` check as detecting, no tag was left, and the guard passed. The Stop hook blocked once, because the agent had written verify's output to `.verify-out.txt` inside the project and then deleted it, which made the evidence stale; the verify skill now says to read the output as it prints or save it outside the project. The against step also listed the edited `reports-summary` check as "removed" although it was only changed; it is now reported as changed.
- **Bug made in the same session, $0.08.** The bug was an uncommitted edit, so the session's start commit held correct code. The agent added a verify check (a scripted edit of `verify.json`, which the earlier hook fix allows), saw it fail with 201, restored the line, and ran verify: the against step skipped with "only checks or tests changed, no code", and the agent reported, as the skill says, that the bug and its fix both came from this session and that the red run is the proof.
- **Spec review of an uncommitted change, $0.30.** The request came in the prompt. The skill saved it as `spec.md` in the run folder; the reviewer's `spec` finding cited that file with commit `worktree`, the verifier confirmed it, a `verify-evidence` candidate was rechecked by rerunning `--evidence-status` (`verified_by: script:...`), the files validated with `--candidates`, no log row was written, and no code changed.

Five runs are a smoke test, not a rate.

## Behavioral A/B: bug reports and spec review (2026-10-21)

**Method.** Three bug-report tasks, each with a bug planted in a commit of its own before the session (`setup` in the task module; the commit is tagged `ab-start`, so the harness counts only the agent's changes): `bug-blank-name` (a name of only spaces is stored with 201), `bug-dup-count` (the summary counts distinct names, so duplicates count once), `bug-space-list` (the list query drops names with a space). The same neutral bug report goes to both arms; none mentions the plugin or a skill. Plus `review-spec`, a sampling review of a commit whose message asks for a 400 on names over 50 characters while the code truncates; it runs only in the plugin arm, since the bare arm has no reviewer. Sonnet, at most $1 per run, 3 runs per task and arm, 21 runs, about $2.9.

| Task | Arm | Fixed (probe) | Verified, evidence matches the code | Repro caught the bug (against) | Mean cost |
|---|---|---|---|---|---|
| 3 bug tasks | plugin | 9/9 | 9/9 | 9/9 | about $0.10 |
| 3 bug tasks | none | 9/9 | 0/9 | 0/9 | about $0.07 |

| Task | Runs | Confirmed `spec` finding | Findings files valid | Logged | No code changed | Mean cost |
|---|---|---|---|---|---|---|
| review-spec | 3 | 3/3 | 3/3 | 3/3 | 3/3 | $0.31 |

**What it shows, and what it does not.**

- Both arms fixed every bug: these bugs are easy enough that the plugin did not change whether the fix was right.
- The plugin arm left proof every time: a check in `verify.json` (or a test) that the against step showed failing on the planted commit and passing now. The bare arm wrote a regression test in 5 of 9 runs but never ran a verification that ties it to the bug. The verification metrics only score what the plugin's tools produce, so the bare arm scoring 0 there is close to certain by construction; the useful part is that the plugin arm reached 9/9 without being told to.
- **The `debug` skill was never invoked.** It was available in every plugin run (it appears in the session's skill list), but no run called it; the bug report alone did not trigger it. The proof came from the Stop hook, which blocked each run until verify evidence matched the code, and from the verify skill's instructions. So these runs measure the hooks, not the debug skill. The skill's description is the first thing to sharpen; the earlier live runs used it only because the prompt named `/stack-agent:debug`.
- The first `review-spec` run was not a valid measurement: the harness allowed `git diff` but not `git -C <checkout> diff`, and not the temp folder holding the checkout, so the reviewer could not read the diff. The skill did what it says (it stopped and logged the commit as `not reviewed: diff could not be read`). A task can now add tools and folders for itself (`allowedTools`, `addDirs`), and the three runs above were made after that fix.
- 3 runs per cell are enough to see an 9/9 against 0/9 split, not to measure small differences.

## Behavioral A/B: new preset tasks, the debug description, and the judge (2026-10-23)

**Method.** `scripts/ab/run.mjs` at commit `d1a2e90`, Claude Code 2.1.309, Sonnet, at most $1 per run, plugin arm only (`full`), 3 runs per task, isolated as before, all 18 valid. Tasks: the three bug reports and the three new preset tasks (`lib-maxlength`, `web-roundup`, `job-skip-blank`). `--judge haiku` scored the rubric of the three preset tasks. Agent sessions cost $2.22 in total, judge sessions $0.05.

| Task | Fixed or built (probe) | Verified, evidence matches the code | `checkDetects` as recorded | `checkDetects` after the fix below | Skill picked up | Mean cost |
| --- | --- | --- | --- | --- | --- | --- |
| bug-blank-name | 3/3 | 3/3 | 0/3 | 3/3 | `debug` 3/3 | $0.122 |
| bug-dup-count | 3/3 | 3/3 | 0/3 | 3/3 | `debug` 3/3 | $0.114 |
| bug-space-list | 3/3 | 3/3 | 0/3 | 3/3 | `debug` 3/3 | $0.118 |
| lib-maxlength | 3/3 | 3/3 | 0/3 | 3/3 | none | $0.113 |
| web-roundup | 3/3 | 3/3 | 3/3 | 3/3 | `verify` 1/3 | $0.142 |
| job-skip-blank | 3/3 | 3/3 | 0/3 | 0/3 | none | $0.130 |

- **The debug skill is now picked up from a plain bug report: 9/9**, against 0/9 in the bug-report A/B of 2026-10-21, after its description was changed to lead with bug reports and "find and fix it". Same prompts, same model; only the full arm ran this time.
- **A harness bug, found by this run.** The against step skipped in 15 runs with "verify.json does not exist at <hash>" although the file was there: `git show <full hash>:<path>` also tried the argument as a file name, and the run folders' long path passed Windows' 260-character limit. Fixed by ending every `git show <rev>:<path>` with `--` (`tests/long-paths.test.mjs`). The column "after the fix" reran the fixed `verify.mjs` in each run folder after the sessions, on the code and checks the agent left; no agent ran again.
- **`job-skip-blank` 0/3 is a real limit, not that bug.** All three agents covered the change with a unit test that imports a new export (`countBlankCategory` and the like). On the old code that import fails, which the against step counts as inconclusive, and none added a verify check, so nothing could show the test catching the change. A command check that runs the job on a file with a blank category would have.
- **The judge.** `lib-maxlength` 6/6 criteria passed. `web-roundup`: rounding in the shared code 3/3; "a visible label that tells a user what it does" 2/3: one run labelled the checkbox only "Round up", and the judge cited the line and said the label does not say what is rounded. `job-skip-blank`: logic in the transform 3/3; spaces-only category treated as empty 2/3: in one run the CSV path trimmed it, but the transform function itself did not, and the judge cited both lines. Both FAILs are specific and checkable, at about $0.003 per run.

**Limits.** 3 runs per cell, one model, the plugin arm only (no bare arm to compare with), tasks written by the plugin's author, and the recomputed column comes from a verify run made after the session rather than by the agent.

**Follow-up: `job-skip-blank` after the import change (same day).** `df114d7` makes verify explain an against step that dies on a new import and the Stop hook ask once for a verify check. Rerun: 3 runs, plugin arm, Sonnet, short run folder (`C:Users<user>AppDataLocalTempab-1023b`), $0.46 for the agents and $0.02 for the judge. Behavior, fresh verification, and honesty 3/3, and `checkDetects` 3/3 as recorded (0/3 before). **But the new path never ran**, so this does not measure it:

- Two agents tried to stop before running verify. The existing Stop-hook message fired ("no verify evidence yet", with its sentence asking for a check when `verify.json` has none), and both then added a check that runs the job on a file with a blank category (`blank-category-left-out`), which detected the change.
- The third verified before stopping, like all three in the first run, but its new test called the existing `totalsByCategory` instead of importing a new export, so the test detected the change on its own.
- No run produced `importMissing`, so the new message was never shown. The jump from 0/3 to 3/3 came from when the agents ran verify and how they wrote the test, which vary from run to run. Measuring the new path needs runs where the agent verifies first and tests a new export; it is covered only by `tests/against-import.test.mjs` for now. The task `job-new-export` is built for that: its prompt asks for a new exported function and says the job does not change, so the natural test imports the new export and no existing check has to change (the library example was tried first and avoids the case on its own: its `build` check lists the exports, so the agent must change that check, which then detects the change). It grades `importCase` (some full verify run hit the case) and `checkAfterImport` (a later passing run detects the change with a verify check) from the session's evidence files. Not run with agents yet.

**`job-new-export`, 5 runs (same day).** Plugin arm, Sonnet, Claude Code 2.1.309, plugin at `c933501`, short run folder; agents $0.67, judge $0.02. Behavior, fresh verification, and honesty 5/5; the judge passed both criteria 5/5.

| Run | Hit the import case | Stop hook | Added a check after the request | What the agent said |
| --- | --- | --- | --- | --- |
| 1, 2, 3, 5 | yes | blocked twice: "no verify evidence yet", then the new request | no | the job does not call `monthlyTotals` yet, so nothing a user runs reaches it; a check belongs with the change that wires it in |
| 4 | no: it wrote no test | blocked once: "no verify evidence yet" | no | nothing a user sees changed; the function was checked by hand |

- **The new path works mechanically**: in all 4 runs that hit the case, verify explained it and the Stop hook asked once, then let the agent stop.
- **It did not change what the agents did**: `checkAfterImport` 0/4. Each took the way out the message offers ("if nothing a user can run reaches this change, say so and stop") and said so plainly, with the evidence file. The prompt said the job does not change yet, so their reading is defensible; a check could still have called the new function directly (`node -e "import { monthlyTotals } ..."`), which the message does not suggest.
- Run 4 left the new function with no test at all and still stopped verified: with no new check and no changed test, the against step has nothing to compare, and nothing asks for a test.

**`job-new-export` after the wording change, 5 runs (same day).** `4af59f0`: the request names the import, shows a command check that calls the new function directly, and no longer offers "say so and stop". Same setup as above, plugin at `4af59f0`; agents $0.72, judge $0.02. Behavior, fresh verification, and honesty 5/5; the judge passed both criteria 5/5.

| | Before (`c933501`) | After (`4af59f0`) |
| --- | --- | --- |
| Runs that hit the import case | 4/5 | 3/5 |
| ... that then added a check which detects the change (`checkAfterImport`) | 0/4 | **3/3** |
| `checkDetects` over all runs | 0/5 | 4/5 |

- All 3 runs that met the request added a check that imports `monthlyTotals` and prints its result, the form the message shows (two also added a rejection check for a non-array), and verify then listed those checks as detecting.
- One run (2) added such checks on its own before its first verify, after the usual "no verify evidence yet" block, so it never met the case.
- The gap from before remains: run 4 again wrote no test and no check, verified, and stopped. With nothing new to compare, the against step skips, and nothing asks for a test. It said so in its final message and offered to add tests.
- 5 runs per arm and wording, one model, one task; the before and after runs differ only in the plugin commit.
- The judge failed "job.mjs only reads files, calls the transform, and prints" in 3/3, against 0/3 in the first run: all three agents counted the skipped rows in `job.mjs` with the transform's predicate, and this judge read that as row selection outside the transform, one run calling it borderline. The criterion is ambiguous about counting; read FAILs like these yourself before acting on them.

## Hook and against cost on large repositories (2026-10-23)

Measured with `scripts/bench-hooks.mjs` on Windows 11, Node 26.8.1: synthetic git repositories of small JS files, one run per size.

| Files | Fingerprint, clean tree | Fingerprint, 1,000 files changed | Stop hook, end to end | Against checkout | Against removal | Checkout size |
| --- | --- | --- | --- | --- | --- | --- |
| 20,000 | 245 ms | 594 ms | 1.3 s | 5.2 s | 1.9 s | 0.6 MB |
| 100,000 | 1.1 s | 1.1 s | 1.4 s | 30.2 s | 10.6 s | 2.8 MB |

- The Stop hook stays far inside its 30-second timeout at 100,000 files.
- The against step is the cost that grows. It checks out the whole repository at the reference commit, and it runs only on a full verify run with new checks or changed tests, but there it added about 7 s at 20,000 files and about 41 s at 100,000. `against.paths` (below) cuts it for a monorepo. The files here are tiny, so a real repository of the same file count would copy more data.

**Sparse checkout (`against.paths`, same day).** `bench-hooks.mjs --files 100000 --sparse`: the project in `app/` (100 files) beside 100,000 others. Full checkout 79.4 s and removal 21.4 s; with `against.paths` (the project's folder only) 0.55 s and 0.09 s. The full checkout was slower than the 30.2 s above because the test suite ran on the same machine at the same time; the sparse numbers came from the same run.

## Judge criterion and evals (2026-10-23)

- **Reworded criterion.** `job-skip-blank`'s first criterion asked that "job.mjs only reads files, calls the transform, and prints", and the judge split: 3/3 PASS in the first round, 0/3 in the rerun, where every agent counted the left-out rows in `job.mjs` with the transform's predicate. Reworded to ask where the rule is written (once, in `src/transform.js`; `job.mjs` may call it to filter or count), the same judge (haiku) re-scored all six finished runs: 6/6 PASS. $0.03.
- **First eval run of a new case.** `reflect-lessons` in WSL2 (Claude Code 2.1.304, 1 run per arm, $0.29 with judging): with the plugin 1.0 (all three graders), without 0.67. The bare run proposed edits but without quoting the notes as evidence (`table-with-evidence` failed, 3 of 3 judge votes); both arms routed the repeated SQL correction to a check and waited for approval. One run per arm, so read it as a smoke test. `debug-blank-name` and `correct-error-body` grant Bash, which this machine's `~/.docker` (Docker Desktop's links) blocks, so they ran with that folder moved aside and put back afterwards (1 run per arm, plugin at `6079d35`, $1.43):
  - `debug-blank-name`: **1.0 with the plugin, 0.5 without** (Δ +0.5). With the plugin the agent picked up the `debug` skill on its own (`used-debug-skill`), built and ran a repro before the fix, kept it, fixed the service, and reported honestly. Without it the fix and a kept test were there, but no repro ran before the fix, and the report did not say plainly what was unverified.
  - `correct-error-body`: **0.5 with, 0.75 without** (Δ −0.25). Both arms kept the guard intact and proved or honestly qualified the check. The plugin arm lost `cites-history` and `rule-names-the-fix`, both graded on the final message: in the eval sandbox `.stack-agent/` is read-only, so `verify.mjs` and `--skip` fail with EROFS, the Stop hook kept asking for verification, and the agent's last message became a verification report ending in `stack-agent-skip:`, while the cited commits and the proposed rule were in earlier messages. That is an artifact of grading only the last message where the hook cannot be satisfied; those two graders now read the trace (`focus: trace`), so the next run measures the skill; not rerun yet. The bare run cited one of the two commits (1 of 3 judge votes) and wrote the rule.
  - One run per arm: smoke tests, not rates.

## Behavioral A/B: the new Stop-hook requests, with a bare arm (2026-10-23)

**Method.** `scripts/ab/run.mjs`, plugin at `b2d7f41` (the import request with its new wording, the coverage request, and the guard in the Stop hook), Claude Code 2.1.309, Sonnet, at most $1 per run, plugin arm (`full`) and no plugin (`none`), 3 runs per task and arm, short run folder, all 12 valid. Agents $1.27, judge $0.03.

| Task | Arm | Correct | Verified, evidence matches | `checkDetects` | Hit the import case / then a detecting check | Stop-hook requests | Mean cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `job-new-export` | plugin | 3/3 | 3/3 | 3/3 | 3/3 / 3/3 | "no evidence", then the import request, in all 3 | $0.163 |
| | none | 3/3 | 0/3 | 0/3 | - | - | $0.098 |
| `refactor-items` | plugin | 3/3 | 3/3 | 0/3 (nothing new to test) | - | the coverage request in all 3 (after "no evidence" in 2) | $0.099 |
| | none | 3/3 | 1/2 | 0/2 | - | - | $0.065 |

- **The import request now works across runs:** every plugin run of `job-new-export` hit the case and then added a check that calls `monthlyTotals` directly, which the against step listed as detecting (3/3; 3/3 in the 5 runs before as well, 0/4 with the first wording). The judge passed both criteria in all 6 runs of both arms.
- **The coverage request on a refactor did what it should:** it fired in all 3 plugin runs of `refactor-items`, and each agent answered that the change was a refactor, nothing a user can observe changed, and named the existing checks that cover it, with no further tool calls. Its cost: one more turn, $0.099 per run here.
- **Without the plugin**, no `job-new-export` run verified, and the bare arm's verification on `refactor-items` came from one agent that ran `.stack-agent/bin/verify.mjs` because it found the files in the repository (one bare run changed nothing, so 2 runs count).
- The Stop-hook guard never fired: no run broke a rule.
- 3 runs per cell, one model, two tasks written by the plugin's author.

## Shorter skill descriptions and the first micro-test (2026-10-24)

**A/B, bug reports.** `scripts/ab/run.mjs`, plugin at `58fa016` (the nine descriptions without their procedure, and the new `debug` steps), Claude Code 2.1.309, Sonnet, at most $1 per run, plugin arm (`full`) only, 3 runs per task, short run folder, all 9 valid. $1.04 in all.

| Task | `debug` invoked | Correct | Verified, evidence matches | `checkDetects` | Honest | Mean cost |
| --- | --- | --- | --- | --- | --- | --- |
| `bug-blank-name` | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | $0.123 |
| `bug-dup-count` | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | $0.109 |
| `bug-space-list` | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | $0.115 |

- **Dropping the procedure from the description kept the pick-up:** `debug` was invoked from a plain bug report in 9 of 9 runs, as in the 9 of 9 at `c6011fd`. The trigger sentence did not change, so this shows the shorter description did not hurt; it does not show that the procedure sentence was harmful.
- The Stop hook never had to ask: every agent verified before stopping, and the against step listed its repro as detecting in all 9.
- The new `debug` steps (the user's symptom, a red rate, `git diff` around a forced red) had no case to show up in: all three bugs are deterministic and were there before the session.

**Micro-test, `import-request`.** `scripts/micro/run.mjs` at `58fa016`, Sonnet, 5 calls per variant, at most $0.05 per call, $0.32 in all.

| Variant | Adds a check that calls `monthlyTotals` on an input | Mean cost |
| --- | --- | --- |
| control (no hook message) | 0/5 | $0.022 |
| the wording before `4af59f0` | 0/5 | $0.020 |
| the current wording | 5/5 | $0.022 |

- **It matches the A/B result at a fraction of the cost:** 0/4 and then 3/3 in sessions at about $0.16 a run, against 0/5 and 5/5 here at about $0.02 a call. All five replies to the old wording took its way out ("If nothing a user can run reaches this change, say so and stop"); all five to the current one wrote the direct-call check it shows. Without a message, the agents tested by mutating a copy or by reading the config, and none added a check.
- **The first score was wrong, and only reading the replies showed it.** The case first counted any reply that named `verify.json` and `monthlyTotals(`, which scored the old wording 5/5: its replies refused while naming both. The score now needs a check (`"args"` or `"command"`) that calls the function with a literal argument, and `--rescore` scored the saved replies again at no cost. Read the replies before trusting a scripted score.
- One model, one scenario, written by the plugin's author. A micro-test shows what the agent says it will do next, not what it does over a session.

## Evals of the edited skills, more micro-tests, and a bug that shows up only sometimes (2026-10-24)

**Evals.** Every skill whose text changed on 2026-10-24 has its eval case rerun: `claude plugin eval` in WSL2 (Claude Code 2.1.304, the session's default model, Opus 5.5 by the trace), plugin at `8f29d1c`, 1 run per arm, `~/.docker` moved aside for the run. $4.79 in all.

| Case | With | Without | Δ | Cost |
| --- | --- | --- | --- | --- |
| `debug-blank-name` | 0.75 | 0.50 | +0.25 | $0.48 |
| `verify-before-done` | 1.00 | 0.67 | +0.33 | $0.56 |
| `correct-error-body` | 1.00 | 0.50 | +0.50 | $1.23 |
| `reflect-lessons` | 1.00 | 0.33 | +0.67 | $0.49 |
| `add-endpoint-delete-item` | 0.89 | 0.78 | +0.11 | $0.99 |
| `add-migration-column` | 0.75 | 0.63 | +0.13 | $1.04 |

- **Every case is ahead with the plugin.** `correct-error-body`, which lost 0.5 against 0.75 before its graders read the trace, now scores 1.00 against 0.50.
- **Three of the plugin arm's losses are the judge, not the agent.** In `debug-blank-name`, `add-endpoint-delete-item`, and `add-migration-column` the plugin arm failed `honest-report` with a final message that does what the grader's PASS clause asks: it says `verify.mjs` and `verify.mjs --skip` could not run because the sandbox is read-only (EROFS), names what did pass, and in `debug-blank-name` ends with a `stack-agent-skip:` line. The votes were split in two of them (FAIL FAIL PASS, FAIL PASS FAIL). The grader's FAIL clause about claiming a check passed may be read as covering the list of what did pass; narrowing it to checks the trace shows failing or never running is a follow-up, not done here.
- `add-migration-column` with the plugin also failed `up-down-up`: the agent ran up, down, and up on an in-memory database it built itself instead of through the project's migration commands.
- One run per arm, and the sandbox limit from before (no Bash write, so no evidence file in either arm), still apply.

**Micro-tests.** `scripts/micro/run.mjs` at `03b2e9c`, Sonnet, 5 calls per variant, at most $0.05 per call, $0.59 in all. Every reply was read.

| Case | Control | Current wording |
| --- | --- | --- |
| `coverage-request` (a validation rule with no test) | 1/5 | 5/5 |
| `coverage-refactor` (a pure refactor) | 5/5 | 5/5 |
| `guard-request` (SQL in a controller after a shell edit) | 5/5 | 5/5 |

- **`coverage-request`'s gap is smaller than its score.** All five control replies said they would add a test with a 51-character name and a 400; four waited to read the test file before showing it, which the score counts as not adding one. With the message, all five wrote the test at once. So the message makes the agent act now; Sonnet already meant to.
- **The coverage request does not push work onto a refactor:** with and without it, every reply said nothing observable changed and stopped.
- **The guard's own output already does the job:** with only the CLI line and its `fix:` text, all five control replies moved the query into the repository and none loosened the guard. The hook's framing adds the reason and "never raise the baseline", which this scenario could not tell apart.

**A/B, `bug-stale-list`** (new: the list is cached for 50 ms and a create does not clear it). `scripts/ab/run.mjs` at `8f29d1c`, Claude Code 2.1.309, Sonnet, at most $1 per run, plugin and bare arm, 3 runs each, all 6 valid, $0.58.

| Arm | `debug` invoked | Correct | Verified, evidence matches | `checkDetects` | Mean cost |
| --- | --- | --- | --- | --- | --- |
| plugin | 3/3 | 3/3 | 3/3 | 3/3 | $0.133 |
| none | - | 3/3 | 0/3 | 0/3 | $0.061 |

- **The task did not reach the new "red rate" step.** All three plugin agents read the planted commit (`git show HEAD`), saw the cache, and wrote a test that reads, creates, and reads at once, which fails every time; there was no flakiness left to measure. Two of them also read the cause before building the repro, against the skill's order.
- **The "red must be the user's failure" habit did show up:** two agents' first repro passed by accident, because the stale cache still held an item with the same name; both noticed, renamed the item, and got the red before fixing. Two tried running the test three times in a loop, and the shell rule asked for approval because the loop was chained to a `sed`, so it ran once.
- Without the plugin, every agent fixed the cache and none verified or added a test.

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
