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
| Sampling review instead of reviewing every PR | `scripts/sample-commits.mjs` + skill `sample-review` + agent `reviewer`, each commit read in its own checkout (`scripts/review-worktree.mjs`); the review log doubles as a ledger, so already-reviewed commits are skipped and files no review has covered are picked first | `tests/sample-commits.test.mjs`, `tests/review-findings.test.mjs` |
| A bug fix starts from a repro that fails (from mattpocock/skills `diagnosing-bugs`, MIT) | skill `debug`: the repro is a verify check or test, so the against step proves it fails before the fix; `no-debug-tags` guard rule in every preset | `tests/presets.test.mjs`; one live run (below) |
| Review against the spec as well as the rules (from mattpocock/skills `code-review`, MIT) | `source: spec` with a quoted `spec: { from, quote }`, checked against the commit message or spec file | `tests/review-findings.test.mjs` |
| Review findings as data, verified by an agent that did not find them (from cloudflare/security-audit-skill) | candidates from `reviewer`, verdicts `confirmed` / `hardening` / `needs_validation` / `rejected` from `finding-verifier`, checked by `scripts/review-findings.mjs` (required fields per verdict, finder is not verifier, quoted excerpts must match the cited line, a finding about a commit must cite a file it changed) | `tests/review-findings.test.mjs`, including tests that the agent prompts name every field and every script flag the docs use |
| Evals as unit tests for skills, blind, judged by another model | `evals/` in `claude plugin eval` format (with/without delta, haiku judge by default), agent `judge`, skill `run-evals` | one case run for real (below) |
| Deterministic work in scripts, judgment to the agent | zero-dependency scripts for every repeatable step | 302 tests |
| Skills: small, composable, with scripts, getting better each use | 10 skills, `reflect` for improving them | `claude plugin validate --strict` |
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
- `review-findings.mjs` proves that a finding is well formed and that its quotes are real code at the cited lines. It cannot tell a right finding from a wrong one; that is the verifier's job, and the verifier is another model reading the same code. The verifier is not shown the reviewer's evidence, but it is shown the claim, so it can still be led.
- An LLM judge in Claude Code can only be another Claude model, so "a different model" means a different Claude model.

## Verification status

| What | Status |
| --- | --- |
| Unit and integration tests | 302 pass on Windows 11, Node 26 |
| All five examples, one per preset (Node API, Python CLI, library, frontend, generic data script) | pass guard and full verify, and fail verify when a behavior is deliberately broken (`tests/sample-presets.test.mjs`, `tests/sample-cli.test.mjs`) |
| Mutation check (14 deliberate bugs) | all caught by the tests |
| `claude plugin validate --strict` | passes |
| Eval `api-map-lookup` (read-only) | run twice for real: 1.0 with the plugin, 0.5 without, delta +0.5. Both answered correctly. The difference is that with the plugin the agent read the map first. |
| Evals that use Bash (`add-endpoint-delete-item`, `verify-before-done`, `add-migration-column`) | run in WSL2 Ubuntu 24.04 (Claude Code 2.1.304, Sonnet, 1 run per arm, about $1.20), but they cannot measure verification there: inside `claude plugin eval`, sandboxed Bash cannot write any file (a probe case found every path read-only, even `$TMPDIR`), so `verify.mjs` and `verify.mjs --skip` fail with EROFS in both arms. The evidence graders were therefore replaced by `honest-report` graders. Tools are granted with `--allow-tools`; the cases' `prompt.md` already lists them (an extra `allowed_tools` in `case.yaml`, added and removed again, was redundant). Setup notes: Node must be outside `/home` (the sandbox cannot read it), and Docker Desktop's links in `~/.docker` stop a Bash-granting eval, so `~/.docker` was moved aside for the run. Every agent, in both arms, told the user the change was unverified; none wrote evidence by hand. Behavior is measured by `scripts/ab/run.mjs` instead (see the A/B sections). |
| CI on Linux and Windows, Node 22/24 | configured, not yet run |
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
