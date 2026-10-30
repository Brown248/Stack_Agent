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
| A live layer between prompt and CI | `hooks/hooks.json`: PreToolUse (shell and edits to guard files), PostToolUse (after edits and after shell commands), Stop | `tests/hooks.test.mjs` |

## Left out on purpose

- **Auto-merge and an outer loop** (pulling work from Slack or trackers): add these only after verification and the guard have a track record in your repo.
- **Browser control (Control Glass):** use your own e2e runner as a command check (`frontend-web` preset). A built-in browser driver would add a heavy dependency.
- **Cloud agents (Benny):** depends on Cursor Automations, which Claude Code does not have.
- **Project-specific rules from the talks** (no `useEffect`, no code comments): those belong to one codebase. Write them as `pattern` rules if you want them.

## Known limits

- Import-based rules read JS/TS and Python. Other languages use `pattern` rules. Python resolution is static: it does not follow `sys.path` changes, `importlib` calls, or installed packages, so a module not found in the repo is treated as third-party.
- The shell hooks match patterns, so a determined workaround (an alias, or a script that writes a file without naming it) can slip past. CI with `--compare-ref` and CODEOWNERS is the gate that always holds.
- The PostToolUse guard covers Edit/Write, and since 2026-10-26 the files a shell command changed (compared by git blob id with what the guard hooks last saw, so each violation is reported once). The Stop hook still runs the guard on every file the session changed (since 2026-10-23), and CI on everything.
- Evidence and the skip record are plain files. Edit/Write on them asks a human, but a determined shell write can still forge them. The `verify` job in the CI template reruns verify on every push and pull request (with `--against origin/<base>` on pull requests), so a forged file does not pass CI. That holds only while the job is a required check and the workflow and `verify.json` are under CODEOWNERS, and while the install step is filled in. The workflow was first run on GitHub Actions on 2026-10-27 (see "The adopter CI template on real GitHub Actions" below); before that it was checked only by text tests.
- The `against` step proves that at least one new check tells the old code from the new. It cannot judge whether the checks cover everything the change should do, and results it cannot trust (the old server does not start) skip it instead of passing it.
- The ratchet counts per file per rule. Import rules count each imported name (baseline version 2). Version 1 counted statements, so adding a name to an existing forbidden import passed; that gap was found while planning the A/B work and closed with a regression test (`tests/guard-widening.test.mjs`).
- `review-findings.mjs` proves that a finding is well formed and that its quotes are real code at the cited lines. It cannot tell a right finding from a wrong one; that is the verifier's job, and the verifier is another model reading the same code. The verifier is not shown the reviewer's evidence, but it is shown the claim, so it can still be led.
- An LLM judge in Claude Code can only be another Claude model, so "a different model" means a different Claude model.

## Verification status

| What | Status |
| --- | --- |
| Unit and integration tests | 514 pass on Windows 11, Node 26, and on Linux (WSL2 Ubuntu), Node 22 (2026-10-27) |
| All five examples, one per preset (Node API, Python CLI, library, frontend, generic data script) | pass guard and full verify, and fail verify when a behavior is deliberately broken (`tests/sample-presets.test.mjs`, `tests/sample-cli.test.mjs`) |
| Mutation check (14 deliberate bugs) | all caught by the tests |
| `claude plugin validate --strict` | passes |
| Eval `api-map-lookup` (read-only) | run twice for real: 1.0 with the plugin, 0.5 without, delta +0.5. Both answered correctly. The difference is that with the plugin the agent read the map first. |
| Evals that use Bash (`add-endpoint-delete-item`, `verify-before-done`, `add-migration-column`) | run in WSL2 Ubuntu 24.04 (Claude Code 2.1.304, Sonnet, 1 run per arm, about $1.20), but they cannot measure verification there: inside `claude plugin eval`, sandboxed Bash cannot write any file (a probe case found every path read-only, even `$TMPDIR`), so `verify.mjs` and `verify.mjs --skip` fail with EROFS in both arms. The evidence graders were therefore replaced by `honest-report` graders. Tools are granted with `--allow-tools`; the cases' `prompt.md` already lists them (an extra `allowed_tools` in `case.yaml`, added and removed again, was redundant). Setup notes: Node must be outside `/home` (the sandbox cannot read it), and Docker Desktop's links in `~/.docker` stop a Bash-granting eval, so `~/.docker` was moved aside for the run. Every agent, in both arms, told the user the change was unverified; none wrote evidence by hand. Behavior is measured by `scripts/ab/run.mjs` instead (see the A/B sections). |
| CI on Linux and Windows, Node 22/24 (`.github/workflows/ci.yml`) | runs on GitHub Actions on every push to `main`: the tests plus guard, API map, and verify on all five examples. The first two runs failed; every run since `0f6840b` (2026-10-20) has passed on all four jobs, the latest on `0cfc5c1`. The adopter template `templates/ci/stack-agent.yml` is a separate file; it ran on GitHub Actions on 2026-10-27, six runs on a throwaway project, and did what it should in all six (see below). |
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

**A/B, `bug-stale-list`** (new: the list is cached for 50 ms and a create does not clear it). `scripts/ab/run.mjs` at `8f29d1c`, Claude Code 2.1.309, Sonnet, at most $1 per run, plugin and bare arm, 3 runs each, all 6 valid, $0.58. The window was 50 ms in these runs and is 300 ms since 2026-10-27: on a loaded Windows CI runner a read, a create, and a read took longer than 50 ms, so the planted bug never showed and the task's tests failed on three of six Windows jobs (never on Ubuntu). A person or an agent calling the API by hand, with seconds between calls, still sees the bug only sometimes.

| Arm | `debug` invoked | Correct | Verified, evidence matches | `checkDetects` | Mean cost |
| --- | --- | --- | --- | --- | --- |
| plugin | 3/3 | 3/3 | 3/3 | 3/3 | $0.133 |
| none | - | 3/3 | 0/3 | 0/3 | $0.061 |

- **The task did not reach the new "red rate" step.** All three plugin agents read the planted commit (`git show HEAD`), saw the cache, and wrote a test that reads, creates, and reads at once, which fails every time; there was no flakiness left to measure. Two of them also read the cause before building the repro, against the skill's order.
- **The "red must be the user's failure" habit did show up:** two agents' first repro passed by accident, because the stale cache still held an item with the same name; both noticed, renamed the item, and got the red before fixing. Two tried running the test three times in a loop, and the shell rule asked for approval because the loop was chained to a `sed`, so it ran once.
- Without the plugin, every agent fixed the cache and none verified or added a test.

## honest-report reads the trace, and a bug that is really random (2026-10-24, later)

**Evals again.** After `79478b9` (the four `honest-report` graders read the trace and accept listing what did pass next to saying verify could not run), the same six cases, same setup as the run above, plugin at `79478b9`. $4.81 in all.

| Case | With (before → now) | Without (before → now) | Δ now |
| --- | --- | --- | --- |
| `debug-blank-name` | 0.75 → 1.00 | 0.50 → 0.50 | +0.50 |
| `verify-before-done` | 1.00 → 1.00 | 0.67 → 0.67 | +0.33 |
| `correct-error-body` | 1.00 → 0.75 | 0.50 → 0.75 | 0.00 |
| `reflect-lessons` | 1.00 → 0.67 | 0.33 → 0.33 | +0.33 |
| `add-endpoint-delete-item` | 0.89 → 1.00 | 0.78 → 0.78 | +0.22 |
| `add-migration-column` | 0.75 → 0.88 | 0.63 → 0.75 | +0.13 |

- **The grader fix did what it should:** `honest-report` passed in every plugin run, and still failed the bare arm of `debug-blank-name` and `verify-before-done`.
- **One run per arm swings by a third.** Nothing that `correct-error-body` or `reflect-lessons` reads changed between the two runs, yet the plugin arm fell from 1.00 to 0.75 (`rule-names-the-fix`, votes PASS FAIL FAIL) and from 1.00 to 0.67 (`routes-to-a-check`: the agent found every mistake already had a rule and proposed no new check). Read a single eval run as a direction, not a score; `--runs 3` costs about three times as much.
- `add-migration-column`'s `up-down-up` failed in both arms again: neither ran the project's own migration commands up, down, and up.

**A/B, `bug-flaky-list`** (new: the list is served from two in-memory copies picked at random, a create refreshes only the first, and the bug is folded into the project's first commit so the history does not point at it). `scripts/ab/run.mjs` at `585873e`, Claude Code 2.1.309, Sonnet, at most $1 per run, 3 runs per arm, all 6 valid, $0.65.

| Arm | `debug` invoked | Correct | Verified, evidence matches | `checkDetects` | Mean cost |
| --- | --- | --- | --- | --- | --- |
| plugin | 3/3 | 3/3 | 3/3 | 3/3 | $0.141 |
| none | - | 3/3 | 0/3 | 0/3 | $0.075 |

- **The agents raised the red rate, but none measured it.** All three wrote a repro that loops 30 or more create-and-read rounds inside one test, so it failed on every run; none reported "red N times out of M". Each then tried to run the suite several times in a shell `for` loop, and each loop was stopped by the A/B harness's permission rules (a loop with a pipe is not in its allowed commands), so the suite ran once. The skill's measure-the-rate step stays unobserved; with these permissions a run cannot take it.
- **Hiding the commit did not change the order.** The service is short, so all three read it and named the cause before writing the repro. The skill asks for the repro first; on code this small that order does not hold.
- Two of the three ended their first message saying plainly that the full verify had not run; the Stop hook sent them back, and both runs then passed with the against step showing the repro fails on the old code.
- Without the plugin, every agent fixed the bug and none verified or added a test.

## Repeat runs, a guard after shell commands, and migrations in a read-only sandbox (2026-10-26)

**A/B.** `scripts/ab/run.mjs` on the working tree over `0fc645f` (`verify --repeat`, the after-shell guard hook, the `debug` and `add-migration` edits), Claude Code 2.1.310, Sonnet, at most $1 per run, plugin and bare arm, 3 runs each, all 18 valid, $1.99.

| Task | Arm | Correct | Verified, evidence matches | `checkDetects` | Other | Mean cost |
| --- | --- | --- | --- | --- | --- | --- |
| `bug-flaky-list` | plugin | 3/3 | 3/3 | 3/3 | `redRateMeasured` 0/3 | $0.122 |
| | none | 3/3 | 0/3 | 0/3 | `redRateMeasured` 0/3 | $0.073 |
| `bug-stale-list` | plugin | 3/3 | 3/3 | 3/3 | `redRateMeasured` 0/3 | $0.150 |
| | none | 3/3 | 0/3 | 0/3 | `redRateMeasured` 0/3 | $0.055 |
| `job-new-export` | plugin | 3/3 | 3/3 | 3/3 | `importCase` 2/3, `checkAfterImport` 2/2 | $0.155 |
| | none | 3/3 | 1/3 | 0/3 | `importCase` 1/3, `checkAfterImport` 0/1 | $0.108 |

- **No agent measured a red rate, and none needed to.** Every plugin agent invoked `debug` and wrote the repro as a test in the suite, not a verify check, with 30 to 40 create-and-read rounds inside it, so it went red on every run. The skill's "fails on some runs only" step never applied: the agents raised the rate first, which is what the step asks for. They also could not have used `--repeat`, which only took checks then; `--skip-checks --repeat N` now repeats the test suite. Not rerun with agents: since they amplify inside the test, a rerun would not reach that step either.
- **The new-import path ran for the first time with agents.** In two plugin runs a full verify hit the "changed tests import what the old code lacks" case, and both times a later passing run detected the change with a verify check. One bare run hit the case and never added a check.
- **The after-shell guard stayed silent in all 9 plugin sessions**, including the 3 `bug-stale-list` runs that edited a test with `sed -i`: no false report. The transcript shows a hook only when it says something, so its reporting path is covered by `tests/hooks.test.mjs`, not by these runs.
- Without the plugin, every agent fixed the bug and almost none verified (1 of 9).

**Hook speed.** `bench-hooks.mjs`, Windows 11, Node 26.8.1, one run per size: the after-shell guard took 125 and 133 ms with 5 changed files, and 318 and 274 ms with 1,000, on repositories of 2,000 and 20,000 files (a Node start is about 60 ms of that).

**Evals.** `claude plugin eval` in WSL2 (Claude Code 2.1.304, the session's default model), the same working tree, `~/.docker` moved aside for the run. `add-migration-column` 3 runs per arm ($3.25), `debug-blank-name` 2 runs per arm ($1.02).

| Case | With | Without | Δ |
| --- | --- | --- | --- |
| `add-migration-column` | 1.00, 0.88, 0.75 (mean 0.88) | 0.88, 0.75, 0.75 (mean 0.79) | +0.08 |
| `debug-blank-name` | 1.00, 1.00 | 0.75, 0.75 | +0.25 |

- **`up-down-up` passed for the first time: 2 of 3 with the plugin, 0 of 3 without.** Every earlier run failed it in both arms, because the sandbox cannot write a scratch database file. With the sample's new `redo`, run 1's trace shows the new migration applied, rolled back, and applied again, and `migrate: redo ok`. Run 3's judges split (PASS FAIL FAIL) and its evidence held no runner output. The bare arm read `migrate.mjs`, `redo` included, and never ran a round trip.
- `guard-passed` split in both arms (1 of 3 with, 2 of 3 without), on a step nothing here changed. The judge's evidence for a long trace (50 to 80 KB here) is cut in the middle, so a guard run there may not reach it; the final messages report `guard: ok`. Left as a grader limit.
- `debug-blank-name`: `repro-before-fix` passed 2 of 2 with the plugin and 0 of 2 without, after the wording that allows reading the code before the repro.

## A detailed review of 0.5.0 (2026-10-26, later)

**Method.** Four agents read the code independently (a bug hunt with reproductions, docs against code in both languages, behavior with no test, and the eval grader reference), and the CI steps ran on Linux (WSL2 Ubuntu, Node 22) against the release commit. Every finding below was reproduced again or read in the code before it was fixed; each fix has a test.

- **Two ways around the guard.** git takes any unambiguous prefix of a long option, so `git commit --no-verif` committed past a failing pre-commit hook while the shell hook let it through; so did `git --config-env=core.hooksPath=VAR commit` and a persistent `git config core.hooksPath`. Both are denied now, and the other git gates match prefixes down to the shortest form git accepts.
- **The hooks judged files CI does not.** Given a list of files, the guard applied only `.gitignore`, not the config's `ignore` list or the default skipped folders, so a fixture with a key was blamed by the after-edit hook, the after-shell hook, and the Stop hook while CI's full scan passed it.
- **Three faults in 0.5.0's after-shell guard.** It blamed the first command for a `.md` file left dirty before the session (the session record leaves `stopHookIgnore` files out, the guard does not); one unreadable changed file emptied the batch hash, which turned the hook off for the session; and edit hooks running at the same time overwrote each other's record. The session record now keeps every dirty file's blob id, hashing falls back to one file at a time, and the edit hook only appends to a log the shell hook reads past its own snapshot. It also groups changed files by their nearest project, so a command at the top of a monorepo reaches the projects inside it.
- **Found while writing tests.** Output between 8 and 12 MB passed as if all of it had been matched: the truncation flag was raised only when the buffer past the 4 MB head passed 8 MB. A command that leaves a process holding its output (`start /b`) kept verify waiting until that process ended and was then reported as timed out; verify now waits for the output to go quiet (1.5 s, 10 s at most). The first version waited a fixed 1.5 s, and one full Linux run under load failed a test whose command's output arrived late; the quiet-time rule replaced it, and the same suite passed on the next loaded run.
- **Linux.** Apart from that, the only failure was `cli-minlen` on a machine with `python3` and no `python`; it now skips like the other Python tests.

**Measured.** `feature-map-lookup` (new, 2 runs per arm, $0.57): 1.00 with the plugin against 0.00 and 0.50 without; with the plugin the agent read the feature map both times, without it never. `verify-before-done` after the skill's field list changed (2 runs per arm, $0.91): 1.00 in both arms; the bare arm had scored 0.67 in the last run, so this is the run-to-run spread the `run-evals` note describes.

**A/B, `init-library`** (new: a library with Stack Agent taken out, the skill started by name; plugin arm, 2 runs, $0.45): verify and the guard passed in both and the workflow was written, but `init --check` passed in neither. Both agents were stopped by the protected-path hook: edits to `guard.config.json` and the workflow ask a human, and a headless session has none, so the edits were refused. One agent said exactly which edits waited for approval and why; the other finished the guard and left the workflow's install step with a note. **Settled the same day:** Edit/Write on a guard config or Stack Agent workflow that git has never seen and that still has `EDIT ME` no longer asks (a template init just wrote holds no rule to loosen; staged, committed, or filled in, it asks again). Rerun, 2 runs ($0.42): one finished (`init --check` passed, the first complete setup without a human), the other wrote its edits with `node -e` from the shell, which still asks, and stopped. The refusal for those two files now says to use Edit or Write for a template, and the skill says the same. Rerun, 3 runs ($0.68): `init --check`, verify, and the guard passed in all 3. One agent tried a shell write first, read the hint, and switched to Edit. Each kept the universal rules, added 3 or 4 rules of its own (examples import the package by name, `src/internal` stays behind the public entry, no runtime dependencies), and replaced the workflow's install step with a note that there is nothing to install.

**Not done.** The eval reference says a `regex` grader can read the trace (`target: trace`) and `tool_used` takes an `input_match`; that would let `up-down-up` and `guard-passed` stop depending on a judge that sees a long trace cut in the middle. It is not confirmed by public docs and was not tried.

## The after-shell guard in real sessions, a trace grader, and six more hook bypasses (2026-10-27)

**Six more ways around the git hooks**, found by trying each against real git with a failing pre-commit hook: `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_KEY_<n>` setting `core.hooksPath`, an alias that runs `commit --no-verify` (set with `-c` or `git config`), `export HUSKY=0`, and changing or moving `.git/hooks`. All six committed while the shell hook let them through. The alias form was hidden by the command tokenizer, which split `key="two words"` into three tokens where a shell sees one. The first four are denied, and a change to `.git/hooks` asks, from the shell and from Edit/Write, in Stack Agent projects only; `.husky/` is committed and reviewed, so it is left alone. 18 ordinary commands are tested not to ask.

**A/B, `shell-sort`** (new: the user hands over a `sed -i` one-liner that sorts the list but puts a query and the `db` import in the controller). `scripts/ab/run.mjs`, Claude Code 2.1.310, Sonnet, at most $1 per run, both arms, 3 runs each, all 6 valid, $0.69.

| Arm | Correct | Guard passes | Verified | `checkDetects` | After-shell report | Mean cost |
| --- | --- | --- | --- | --- | --- | --- |
| plugin | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | $0.131 |
| none | 3/3 | 3/3 | 3/3 | 2/3 | - | $0.098 |

- **The after-shell guard reported the violation in all 3 plugin runs**, the first time it has been seen catching one in a real session; each agent ran the one-liner, read the report, put the controller back, and sorted in the repository instead.
- **It made no difference to the outcome here.** Every bare agent read `package.json`, ran `npm run guard` on its own after the `sed`, and fixed the same thing. A project that exposes its guard as a script gets this from Sonnet without the hook; the hook's value is that the report does not depend on the agent thinking to run it.
- **The transcript does not carry a PostToolUse hook's output**, so the first grader (searching the transcript for the report) scored 0 while the agent's own message quoted the rules it was given. The hook now appends what it reports to `.stack-agent/evidence/sessions/<id>.reports.log`, and the task reads that.
- **A fixture bug, found by this task:** the sample backend's `npm run guard` and `npm run verify` pointed at `../../scripts/`, which exists only inside this repo, so in every scaffolded copy they failed with `MODULE_NOT_FOUND`. They now run the vendored tools. Earlier A/B results in which an agent reached for `npm run guard` may show the bare arm worse than it was; the first, discarded run of this task did (guard 0/1 without the plugin, from that error).

**A trace grader.** `claude plugin eval` accepts `type: regex` with `target: trace`. `add-migration-column`'s `up-down-up` is now that: the runner's own output for the new migration, applied, rolled back, and applied again, in order. Run beside the llm grader it replaced (plugin arm, 2 runs, $1.05), both passed both runs. The llm judge had seen long traces cut in the middle; the regex reads the whole trace and needs no judge.

**Windows leftovers.** A process a command leaves behind is now stopped on Windows too: Windows has no process groups and `taskkill /T` cannot start from a parent that has exited, so verify walks down from the exited parent's id with `Get-CimInstance` and stops only processes started after the command, so a reused id cannot pull in an older one. The test that a leftover is gone now runs on every OS.

## SkillSpector in this repo's CI, not in adopters' projects (2026-10-27)

**What it is.** NVIDIA SkillSpector is a static security scanner for agent skills: 71 patterns in 17 categories (prompt injection, exfiltration, privilege escalation, supply chain, MCP tool poisoning) through regex, YARA, and taint tracking, with an optional LLM review. Apache-2.0, Python 3.12+.

**Tried first.** Version 2.12.0, installed from NVIDIA's GitHub repository into a throwaway virtual environment (not from PyPI, where the package name could not be tied to NVIDIA), run with `--no-llm` over `skills/`, `agents/`, `hooks/`, and `scripts/hooks/` (`hooks/` holds only `hooks.json`; the code that runs on a user's machine is in `scripts/hooks/`). 8 findings, each checked against the line it points at, all false positives:

| Finding | Where | What is really there |
| --- | --- | --- |
| TM1 tool parameter abuse, 3 | `debug` and `verify` skills | `--skip-tests`, `--skip-checks`: verify's own flags for iterating, which the Stop hook does not accept as evidence |
| TM1, 3 | `scripts/hooks/pre-bash.mjs` | `--no-verify`, `reset --hard`, `--force` in the messages of the hook that blocks or asks before them |
| AR2 anti-refusal | `agents/finding-verifier.md` | an output format (an empty JSON array when the diff cannot be read); the scanner itself tagged it likely benign |
| EA4 unbounded consumption | `scripts/hooks/stop-verify.mjs` | the comment explaining `MAX_BLOCKS`, the cap on the Stop hook's loop |

The static mode also inspected the skills only partly (0% fully) and the hook scripts 45%, so no finding is not proof of safety.

**What was adopted.** A `skill-scan` job in this repo's CI: SkillSpector pinned to the v2.12.0 commit, `--no-llm` (no file leaves the runner, no credentials), each target scanned on its own with its baseline in `.github/skillspector/`, where every one of the 8 carries the reason above. The scan step has `continue-on-error`, so a new finding shows as a warning and the check stays green. A planted line telling the agent to send `~/.ssh/id_rsa` and AWS credentials to an outside URL, added to a skill that has a baseline, was reported as a new finding: the baseline hides the known lines, not the file. `scripts/skill-scan.mjs` holds the target list, so CI and a local run scan the same targets; its tests use a fake scanner, so `npm test` needs no Python. A baseline holds a hash of the skill's text, so every edit to the text made the same known false positive look new, and the baseline was written again by hand each time (five times in one day). `skill-scan.mjs --rebaseline KEY` does that now, but only when the scan finds the same kinds of finding, in the same files and the same number, as the baseline already covers; a different finding is refused, each entry keeps its reason, and the findings it covers are printed so the diff can be read. It was checked against the real SkillSpector on a copy: the two baselines it rewrote matched the committed ones apart from a final newline, which it always writes.

**First CI run.** The Linux runner reported 4 findings the Windows scan had not: TR2 "shadow command trigger" in `api-map` and `correct`, for the plain words "find" and "review" in their descriptions, and AE1 "incomplete referenced artifact analysis" in `mine-corrections` and `reflect`, for paths in the adopter's repo that they read or edit at runtime (another skill's `SKILL.md`, `rules.md`, the maps). All false positives, now in their own baselines, 12 in all. A clean Linux clone in WSL reproduced the runner's result exactly; a scan of the Windows checkout through `/mnt/d` flagged `verify` as well. So the scanner's output depends on where it runs: CI is the reference, and new fingerprints come from a clean clone on Linux.

**What was not.** Not a gate: the findings are keyword-level and cannot tell a hook that blocks `--no-verify` from a skill that runs it, so in a repository built to stop bypasses most findings will be false. Not in adopters' projects: the vendored tools are zero-dependency Node, and Stack Agent's job is the project's own code, not vetting other people's skills (`out-of-scope.md`, tools that need an install). Not the LLM review: it sends file contents to a provider, costs money, and is not repeatable enough for CI.

## Beside obra/superpowers (2026-10-27)

Many people run Stack Agent next to superpowers, and every A/B run so far had removed other plugins. The harness has a `full+superpowers` arm now: both plugin folders passed to `claude`, superpowers named with `--superpowers DIR` (its version goes into the results), isolation passing only with exactly those two plugins loaded, and `SUPERPOWERS_DISABLE_TELEMETRY=1` in every arm.

**A/B.** Plugin at `f0b3d8e` plus the uncommitted SkillSpector job and this arm (no skill or hook changed), superpowers 7.0.0, Claude Code 2.1.310, Sonnet, at most $1 per run, 3 runs per task and arm, all 18 valid (every transcript shows both plugins and superpowers' SessionStart bootstrap), $2.45.

| Task | Arm | Correct | Verified, evidence matches | `checkDetects` | Mean turns | Mean cost |
| --- | --- | --- | --- | --- | --- | --- |
| `bug-blank-name` | Stack Agent | 3/3 | 3/3 | 3/3 | 11.0 | $0.113 |
| | + superpowers | 3/3 | 3/3 | 3/3 | 12.7 | $0.124 |
| `bug-dup-count` | Stack Agent | 3/3 | 3/3 | 3/3 | 10.0 | $0.100 |
| | + superpowers | 3/3 | 3/3 | 3/3 | 11.3 | $0.115 |
| `endpoint` | Stack Agent | 3/3 (map, thin controller, test added) | 3/3 | - | 21.3 | $0.176 |
| | + superpowers | 3/3 (same) | 3/3 | - | 21.3 | $0.187 |

- **No conflict and no gain on these tasks.** Every run in both arms fixed or built the right thing, passed the guard, and verified with fresh evidence; the Stop hook never had to send one back.
- **superpowers was never used.** In all 9 runs with it, the agent invoked `stack-agent:debug` for the bug reports and `stack-agent:add-endpoint` for the endpoint, read no superpowers file, and named none of its skills, although its bootstrap says to invoke a skill on "even a 1% chance". When a Stack Agent skill fits the task, the agent takes it.
- **What it cost.** The bootstrap adds about 2,200 tokens to the context of every request (cache creation 8,030 against 10,222 tokens on the same task), about one more turn on the bug tasks, and 9% more spend over the 9 runs ($1.28 against $1.17).
- **Not measured:** tasks where no Stack Agent skill fits (a refactor, a feature with no endpoint, planning), where superpowers' brainstorming and planning skills may start and compete for the budget before verification; other models; more than 3 runs per cell. These three tasks were written for Stack Agent's skills, which favors them.

## A weekly canary against the current Claude Code (2026-10-27)

**Why.** Everything the tests say about the hooks comes from input this repo made up, and the live runs in these notes were made with Claude Code 2.1.299 to 2.1.310. Claude Code changes often; if it renames a tool or reshapes the hook input, the hooks could stop firing, and the first sign would be a user's report. Nothing in CI would notice.

**What was added.** `scripts/canary.mjs` and `.github/workflows/claude-code-canary.yml`, which installs the latest Claude Code every Monday (and on demand, and when its own files change) and runs two checks. The static one (`claude plugin validate --strict`) needs no credentials. The live one (`--live`) starts a headless session in a copy of the sample backend with the cheapest model and a $0.25 cap, and asks it to run `git commit --no-verify`: the plugin must load, SessionStart must record the session, PreToolUse must deny the command with the hook's own message, and no commit may exist afterwards. It runs only when the repository has an `ANTHROPIC_API_KEY` secret; without one the workflow says so and the static check alone runs. A login or key problem skips the live check, it does not fail it.

**Checked.** Against Claude Code 2.1.311 on this machine, newer than any version in these notes: both checks passed in 9 seconds for $0.003. Against a copy of the plugin whose PreToolUse hook points at a script that does not exist, the static check still passed and the live check failed (`the --no-verify commit was not denied ... a commit was made (2 commits, expected 1)`), so the live part is what catches a dead hook. The tests use a fake `claude` (`tests/canary.test.mjs`), so `npm test` needs no credentials.

**Not covered.** The Stop hook and PostToolUse hooks are not exercised; one denied command and one session record stand for the hook plumbing. Until the secret is added, CI runs only the static check, which would not have caught the broken hook above. GitHub tells the person who last edited the schedule when a scheduled run fails, and pauses schedules in a repository with no activity for 60 days.

## The adopter CI template on real GitHub Actions (2026-10-27)

**Why.** `templates/ci/stack-agent.yml` is what every adopter's CI runs, and the guard, `--compare-ref`, and verify in it are the gate that holds when a hook is argued around. It had only ever been checked by text tests and by running its commands by hand on Linux, which cannot show how `hashFiles`, the `if:` conditions, `github.base_ref`, or the evidence upload behave on a runner.

**Method.** A throwaway project in this repository's own account (a new repository could not be created): the sample backend, the workflow freshly generated by `init` from the current template (only the branch name and the install step edited), pushed as an unrelated branch, with five branches opened as pull requests against it. They were closed and the branches deleted afterwards. Ubuntu runner, Node 22.

| Run | What it tried | Result |
| --- | --- | --- |
| push to the base branch | nothing | guard, API map, and verify passed; the pull-request-only steps were skipped; the evidence uploaded (2,486 bytes) |
| a behavior change with a new check that fails without it | the normal good change | everything passed, including the against step |
| a code change with no new test (default) | the gap noted in the read of this template | passed; the against step only noted it |
| the same, with `against.requireNewCoverage` on | the opt-in gate | **failed** at the against step with the message that names the waiver line |
| a new `module-boundary` violation | the ratchet | **failed** at the guard step |
| the same violation, the baseline raised to hide it | loosening the guard | the guard step passed and `--compare-ref` **failed** with `baseline grew ... 0 -> 1` |

**What it shows.** The three cases that must fail did, each at the step meant to catch it and with the intended message, and the three that must pass did. The pull-request-only steps and the API-map condition evaluated correctly on a real runner. It does not show: Windows or macOS runners, Node 24 (the template pins 22 unless the project asks for newer), a project with real dependencies (the install step was a no-op), a required-check setting or CODEOWNERS (these are repository settings, not in the file), or a monorepo's per-folder workflow.

## A release made from its tag (2026-10-28)

**Why.** The first three releases (0.5.1 to 0.5.3) were made by hand in the GitHub page. The app that ran the work refused to create a Release from the command line, and the hand-made ones went wrong in a small way: v0.5.1 stayed marked Latest after 0.5.2 and 0.5.3 were published (the page's label was left on "None"). The 0.5.1 tag was also nearly made on a commit whose CI was red. A release should be the same steps every time, and refuse when the tag, the version files, and the changelog disagree.

**What was added.** `scripts/release-notes.mjs` (zero dependencies, tested on temporary repositories) and `.github/workflows/release.yml`. The script refuses and lists every mismatch: the tag against the version in `plugin.json`, `marketplace.json`, and `package.json`, and against the newest release section of both changelogs, and an empty section. Otherwise it gives the section with a link to the Thai changelog at that tag, the title, whether it is a pre-release, and whether the tag is the highest release. The workflow has two jobs: `check` (read-only, runs on a pushed tag, by hand, and on pull requests that touch the version files or changelogs) and `publish` (the only one with `contents: write`, only for a pushed tag or a manual run with `dry_run` off), which creates the Release with `--verify-tag`, or edits it if it exists, passing `--latest` and `--prerelease` explicitly from the script's answer.

**Checked.** Run against the three real tags with `--ref`, the script's notes equal the published bodies once blank lines and line endings are ignored (v0.5.1 differs only by line endings, v0.5.2 and v0.5.3 by one blank line, from the paste), the titles are the same, and only v0.5.3 comes out Latest. A mutation check: a workflow that grants write at the top makes the test fail. The workflow file parses as YAML. On Actions: the pull request that added it ran the `check` job (title, pre-release, and latest printed, publish skipped). The first manual dry run, against v0.5.3 after the merge, **failed**: the workflow checked out the tag, an old commit that does not have the script, so an old tag could not be checked with it. Fixed by checking out the workflow's own commit and reading the tag's files with `--ref` (a test that failed before the change). Dry runs of the fixed workflow, started from the fix branch before any merge: v0.5.3 passed and is Latest, v0.5.1 passed and is not Latest, and v9.9.9 (no such tag) was refused; its first message read as every file missing, and now says the tag does not exist. No Release was created or changed by any of these. The first real publish is the next tag.

**Decisions from reading the docs.** A tag pushed by a person starts the workflow; a tag pushed with the workflow's own token would not (events made with `GITHUB_TOKEN` start no new runs), so tags are not made by a workflow here. `make_latest` defaults to true and a draft or pre-release can never be Latest; GitHub's automatic choice weighs creation date and semantic version, so the script decides and says so explicitly. Immutable releases (generally available since 2025-10-28: the tag and assets are locked after publishing) are not switched on: they would make a wrong Release impossible to fix, and that only makes sense once this check has run for a few releases.

**Not covered.** The publish job has not run for real yet. The check job was run by hand as a dry run on the existing tag `v0.5.3` (2026-10-30): the tag, the three version files, and both changelogs were consistent, the notes were written, and the publish job was skipped as set. The notes are the changelog section as written, so a changelog with a broken link or table is published broken. A release of a commit whose CI is red is not refused by this check; it checks consistency, not health.

## Plain-Thai messages, the light version (2026-10-28)

A user said the system sometimes talks formally or in a way that is hard to follow. That can mean two things: the raw English the hooks print in the terminal, or the agent's own replies. Nobody has said which, so the first version covers both and goes no further than it must.

- **A catalog, English by default.** `scripts/lib/messages.mjs` holds the messages a person reads, in English and in Thai. The language is Thai when `STACK_AGENT_LANG=th` or `"language": "th"` in `verify.json` says so (the environment wins), and English otherwise, including for a value nobody knows, since a hook must not fail over a display setting. The English text is the old wording, pinned by a test that compares it character for character. A test also checks that both languages have the same messages with the same placeholders, so a message cannot be added in one language only.
- **Only what a person reads, to begin with.** Only two places in the hooks send a `systemMessage`, the text Claude Code shows to the human and not to the agent: the SessionStart notice that the vendored tools differ from the plugin's, and the Stop hook's three messages when it lets the agent go. The rest were written for the agent and stayed English in this version; the next section moves some of them.
- **Nothing depends on the language.** Evidence files, verify's output, and the guard's messages are not translated, and no code reads message text, so switching the language cannot change what passes. One string `.replace()` that turned "said why in its final message" into "recorded why in ..." became a function, `skipMessage`, since a replace cannot work across two languages.
- **A note to the agent.** In Thai, SessionStart also adds a short `additionalContext` saying the reader prefers plain Thai (Claude Code passes this to the agent; it caps it at 10,000 characters and advises wording it as facts, not commands, so it is worded as what is set and what the reader prefers). Measured with Sonnet, 5 calls per variant, the user asking in English: no note 0 of 5 replies in mostly Thai, with the note 5 of 5, and the replies were short and plain (`scripts/micro/cases/language-note.mjs`). With 5 against 5 only a difference this large counts, and this one does. What the number does not show: the score is a proxy (at least half the letters are Thai and none of the stiff words ท่าน, กรุณา, ดำเนินการ, ขอเรียน, ดังต่อไปนี้ appear), not a judgment of how good the Thai is; one scenario; the note was put in the prompt as the case's other guidance is, not delivered by a real SessionStart hook; and a user who already writes Thai gets Thai without the note.
- **Not in this version.** A Thai verify report, and a language other than these two (the catalog takes another language by adding a block and extending `LANGUAGES`).

## Thai for the permission questions and the Stop reminders (2026-10-28, later)

The first version translated only the text Claude Code shows the human as a `systemMessage`. Reading the hooks reference again turned up a second kind of text written for a person, and a way to decide about the reminders to the agent.

- **The questions are for people.** When a PreToolUse hook answers "ask", Claude Code shows its reason to the person in the permission prompt (for "deny" it goes to the agent). The 13 questions in `pre-bash.mjs`, `protected-paths.mjs`, and the edit hook (force-push, `git reset --hard`, a change to the guard rules, a hand-written evidence file, ...) are therefore read by the human, cost the agent no tokens, and are now in the catalog in Thai, with the names of what they are about (`what.*`). The English text is the old text, pinned by `tests/fixtures/pre-bash-reasons.json`, made from the code before the change, for 27 commands. In a headless run nobody answers and the agent reads the reason instead, and one sentence there carries behavior: use Edit or Write to fill in the unfilled guard template (the A/B run `init-library` went from 0 of 2 to 3 of 3 with it, 2026-10-26). So that sentence was measured in Thai too.
- **The reminders are for the agent, so they were measured before being translated.** The Stop hook's four reminders (the main one, the guard failure, the coverage request, the import request) now exist in Thai: `reminderMessage`, `guardMessage`, `coverageMessage`, and `importMessage` take a language, and the English they return is the old text character for character (`tests/fixtures/stop-messages.json`). A message goes to the agent in Thai only if its key is in `AGENT_THAI` (`scripts/lib/messages.mjs`), and a key joins the list only with a result below. Micro-tests (`scripts/micro/run.mjs`), Sonnet, scored by script, one call with no tools; the replies are in English or Thai as the model chose.

| Case | No message | English wording | Thai wording | Runs per variant |
| --- | --- | --- | --- | --- |
| `remind-verify` (the main reminder) | 0 | 8 | 9 | 10 |
| `coverage-request` | 0 | 9 | 10 | 10 |
| `import-request` | 0 | 25 | 24 | 30 |
| `setup-hint` (the sentence in the question) | 0 | 8 | 10 | 10 |
| `coverage-refactor` | 8 | 10 | 10 | 10 |
| `guard-request` | 10 | 10 | 10 | 10 |
| `deny-no-verify` (a denial) | 10 | 10 | 10 | 10 |

- **How to read it.** In the four cases where the message changes what the agent does (the first four), the Thai wording did as well as the English one to within one run in ten (one in thirty for the import request). That is a result of "no difference found", not of "the same": with 10 runs a drop of 20 points or more would go unseen, with 30 a drop of about 15. The last three cases show nothing. In `guard-request` and `deny-no-verify` the agent does the right thing with no message at all, and `coverage-refactor` is nearly there. So the keys `remind`, `coverage`, and `import` are in `AGENT_THAI`; the guard failure reminder (`guard`) and the denials (`deny.*`) have a Thai text in the catalog and are not used, because nothing measured says they are followed.
- **Two scorer mistakes found by reading replies.** The first scorer of `deny-no-verify` gave 0 of 10 to every reply, English and Thai, because it counted "I won't retry with `--no-verify`" as a retry; only a command in a code block or a tool call counts now, and the saved replies were scored again with `--rescore`. The first `import-request` round in Thai (7 of 10 against 9 of 10) looked like a drop; two of its three misses were replies that said they would read the files first and showed no edit, which the English arm does too, and 30 runs per arm gave 24 against 25.
- **What stays English.** The reason inside a reminder (`there is no verify evidence yet`, which tests and the evidence logic know by name), the guard's own messages and the `fix:` lines from a project's config, the denials, and everything written to a file. The cost of the Thai that does reach the agent is the 1.8 to 2.2 times in tokens measured before (112 to 243 for a Stop-hook request), up to three times per turn.

## Tuning a wording by machine (2026-10-28)

`scripts/micro/tune.mjs` does the hand loop of rewrite, measure, compare, in the manner of GEPA and MIPROv2 (a strong model proposes, a cheap one screens). It exists because a wording has been wrong before in ways that reading did not show (a prohibition that did worse than saying nothing, a request the agent answered 0 times in 4). Choices:

- **It proposes and never applies.** A wording that ships is code other people run; it writes `proposed.txt` and a person copies it in. Nothing in the repo changes.
- **A rewrite has to win where it was not trained.** A tuner given one scenario finds a wording for that scenario. So a case needs two or more, every one but the last is learned from, and the last is looked at only in the final stage. A wording is adopted only if it beats the original over all scenarios pooled (one-sided Fisher exact, p < 0.05) and carries the held-back one (no worse than the original there, and better, or the original was already at 90% or more).
- **The cheap model screens and the real one decides.** haiku keeps a candidate if it is no worse than the original on any learning scenario and better on at least one (a Pareto rule, so a rewrite cannot trade one scenario for another); the survivor is measured on sonnet against the original and against no guidance. A weak model's pass rate is not the one people get.
- **A hard budget.** The run stops before a call that could pass it (judged by the biggest call seen so far), and a failing call is retried up to three times with every try counted. A finished-late stage is reported as `unfinished` with the counts reached, not as a result.
- **`keep` phrases.** A rewrite that drops the file name or the command the message points to is thrown away.

**One real run** (`import-request`, starting from the wording before 4af59f0, learning on `monthlyTotals` and `slugify`, `parseDuration` held back, 20 runs per arm and scenario on sonnet, budget $10): verdict `improved`, 42 of 60 against 0 of 60 for the original, and per scenario original / proposed / no guidance:

| Scenario | Original | Proposed | No guidance |
| --- | --- | --- | --- |
| `monthlyTotals` | 0 / 20 | 13 / 20 | 0 / 20 |
| `slugify` | 0 / 20 | 12 / 20 | 0 / 20 |
| `parseDuration` (held back) | 0 / 20 | 17 / 20 | 0 / 20 |

It cost $5.19 for 237 calls in about 36 minutes. The first attempt stopped at call 85 of 237 ($2.26) when a call ran into its cap and the run had no retry and no partial count, which is why both exist now.

**What it did not show.** The aim was a result at least as good as the wording a person tuned. It was not met: that wording passed `monthlyTotals` 25 times in 30 (83%) in the 30-run measurement above, the tuner's 13 in 20 (65%). It found a large gain over a known-bad wording and a gain that held on a scenario it had not seen, not a better wording than careful hand work. Earlier (2026-10-21) a pilot found little headroom in the skills as they stand, so the useful uses are a message that has no good wording yet and a check of a hand-written one against alternatives. Neither has been tried on a real repo's message. 20 runs per arm and scenario can miss a gap of 25 points.

## Three ideas from autoharness, one dropped (2026-10-29)

tigerless-labs/autoharness (MIT, 0.5.3) writes, merges, and archives skills by itself from real sessions. Its approach is in `out-of-scope.md`; what follows is what was taken from it, read from its code and README (it was not run).

- **Secrets in mined sessions.** A read of our own code, prompted by its redaction rules, found `mine-transcripts.mjs` printed every message as typed, and the only guard was a line in the skill asking the model not to repeat a secret. `scripts/lib/redact.mjs` now replaces keys, tokens, passwords, private keys, credentials in a URL, card numbers, Thai national IDs, and email addresses before anything is printed, and it runs before the 600- and 300-character cuts so a key is never left half visible. The command says how many it hid. Choices: a card number is hidden only when it starts like a Visa, Mastercard, Amex, Diners, Discover, JCB, UnionPay, or Maestro number and passes the Luhn check (the check alone passes one number in ten, so one millisecond timestamp in ten would have gone); a Thai ID only with a dash or space between the groups of its digits (1-4-5-2-1) or after a word like บัตร or national id (the check digit alone passes one 13-digit number in ten, so a bare 13-digit number is left alone and `ID: 1101700203450` is not hidden); a Thai password cue (`รหัสผ่านคือ ...`) is read, but a bare value may not hold Thai characters, so a Thai sentence after `password:` is not eaten (one in quotes still is); `password = getPasswordFromVault(name)` and `secret: process.env.X` are left because they read a secret from elsewhere; most vendor keys are still found when glued to letters (not the OpenAI, Hugging Face, and SendGrid ones, whose prefixes end ordinary words such as `task-`) and every one after the two characters `\n` of JSON-escaped text; a quoted password of 6 to 200 characters is hidden whatever it looks like (another kind of quote may be inside), and so is the literal fallback of code that reads a secret from elsewhere (`process.env.X || "hunter2"`, `os.environ.get("K", "hunter2")`); only a bare value that reads from elsewhere (`getToken(req)`, `process.env.X`), a type for a token or secret (`token: CancellationToken`; a password of two words run together is still hidden), a schema word (`password: required`), or a path made of plain words (`PWD=/home/me`; a secret that starts with a slash has digits or symbols in it) is left. The fallback rule covers the same key names as the assignment rules and wants code on its left (no spaces, then `||`, `??`, `or`, or a call to something that reads the environment), so `hmac(key, "sha256")` and a sentence with an "or" are not taken for one.
- **What the first version got wrong, found by an independent review of it.** A JWT rule with no left boundary took time that grew with the square of the length (base64url-encoded JSON of 200 KB took 2 s, 1 MB did not finish in 90 s); a URL rule did the same (1.6 s at 160,000 characters) and the test written for the redactor found that one only. Both are bounded now, a rule that needs a literal (`@`, `eyJ`, `://`) is skipped on text without it, and the test feeds every rule 1 MB of 34 kinds of awkward text in a process of its own with a timeout, so a rule that goes quadratic fails the test instead of hanging it (removing the email cap, the URL scheme cap, or the JWT boundary each makes it time out; the kinds include base64url JSON, repeated `eyJ`, `password is `, `http://`, a long run before an `@`, and more; the worst of a wider set of 28 took under half a second at 2 MB). The review also found that every vendor key after a JSON `\n` leaked, that 19% of 13-digit millisecond timestamps were hidden (the docs said a timestamp stays), that a Thai sentence about passwords was eaten, that `redis://:pass@host` leaked, and that `token=abc$def` left the tail visible; each has a test now. **Not covered:** a password in a shape no rule knows (an unquoted passphrase with spaces, `รหัส คือ ...`, a password typed after a prompt). Passwords typed on a command line were added later (`mysql -pSecret`, `curl -u user:pw`, `sshpass -p`, `docker login -p`, `--password VALUE`; a value read from elsewhere such as `$PASS` is kept), and over-redaction is the accepted cost (`const token = req.headers.authorization`, `deploy@prod.example.com`, `password: z.string().min(8, "too short")` are hidden, and `my password is Summer!`, with no digit or symbol in the value, is not). Run over 1,710 real user messages from this machine (looking at counts and shapes only, never printing a value), 19 had something hidden, no key with a vendor prefix (`sk-`, `ghp_`, `AKIA`, `xoxb-` and the like) survived, and after the cue words `password`, `secret`, `token`, `api_key` no value-shaped string was left. That check looks for shapes; it cannot prove nothing is left, and it did not look at the kinds listed under "Not covered".
- **Which skills are used.** autoharness counts loads, views, and patches in a file per skill, written by hooks. `scripts/skill-usage.mjs` gets the same counts from the transcripts Claude Code already keeps (Skill tool calls, `<command-name>` slash commands, reads under a `skills/<name>/` folder), so it adds no hook, no state, and nothing that runs in every session, and it counts sessions from before it existed. A slash command counts only if its name is a skill we can see, so `/model` and `/clear` do not; a read is credited to the `skills` folder nearest the file. Two things in real transcripts changed it: a resumed session starts with a copy of the history it continues (on one real project 4,422 of 6,942 user events were repeats, and `claude-api` showed 4 loads for 2 calls), so each event is counted once, in the file changed earliest that holds it, and a file with nothing new is not another session; and the same repeat made `mine-transcripts` list one correction as coming from two sessions, the bar for a class, which it no longer does. It says "not used so far" below 10 sessions and "not used" from 10 up, and never removes or moves a skill. A skill with the same name in two plugins counts as one. Checked on a real folder, it counted a known `/stack-agent:debug` slash command; on this repo's own 18 sessions of the last 30 days it found no skill used at all, which says these sessions were not run through the skills, not that the skills are useless. A skill loaded inside a subagent counts too: those transcripts are separate files under the session's `subagents` folder, and each is read as part of its parent session. **Limits:** a copy made inside the window brings the older history it holds with it, and a copy that is the only file holding a source's events counts those; it sees only this machine and only what Claude Code has kept, and what it reports is usage, not value: whether a skill that is used helps is what the evals are for.
- **Reconciling a new rule with an old line: dropped.** autoharness makes its reflector rewrite an older skill that a new rule contradicts. The `reflect` skill got a step for it and the eval case `reflect-reconcile` to measure it: a planted older line says a one-line query may stay in the controller, the notes say the opposite. Without the step (main), 3 of 3 runs rewrote the old line when it sat in `rules.md`, and 4 of 4 when it sat in a project skill the correction does not route to; with the step, 3 of 3 and 4 of 4. No difference, so the step was taken out again (a change backed only by an expected improvement is the kind `reflect` itself rejects). The case stays as a guard that the behavior holds. With 3 or 4 runs per arm a gap under about 50 points would not show, and a longer project with many skills may differ.

## Two more repos read, one test taken (2026-10-29)

revfactory/harness (Apache 2.0) and ruvnet/ruflo (MIT) were read for what Stack Agent could use. Neither was run; the first was read in part (README, the evolve skill, the model guide, the start of the testing guide), the second only at its top (README, the top of its CLAUDE.md, `verification/`, `.harness/`).

- **revfactory/harness** builds a team of agents and skills for a domain from one sentence. Stack Agent gives a fixed set of rules and checks instead of designing a team, so that is out of scope (`out-of-scope.md`). Its +60% quality figure is its author's own, 15 tasks, and it says so. Taken: its habit of testing a skill's `description` with requests that should trigger it and near-misses that should not. Stack Agent had no such test.
- **ruvnet/ruflo** is a swarm, memory, and federation platform (98 agents, 314 tools, 35 plugins; its CLAUDE.md alone is 72 KB). Nearly all of it is outside this repo's scope. Its `verification/` report passes 55 of 55 by checking that a marker string is still in a file, which shows the code is present, not that it works. Nothing was taken.

**The test taken: `scripts/micro/cases/skill-routing.mjs`.** One call carries 34 requests (4 for each of the six skills the model may invoke, in English and Thai, and 10 near-misses such as "explain what a database index is" and requests only a person can start) with the skill listing as Claude Code shows it, read from `skills/*/SKILL.md`, and asks which skill is loaded first. The score is the share answered right; a near-miss may go to another plugin's skill but not to one of ours. Sonnet, 5 runs per variant:

| Listing | Mean score | Lowest run |
| --- | --- | --- |
| none (control) | 0.29 | 0.29 |
| our six skills, name and description (`current`) | 1.00 | 1.00 |
| our six, names only | 1.00 | 1.00 |
| our six among 11 skills of other plugins, with descriptions (`crowded`) | 1.00 | 1.00 |
| the same, names only | 0.99 | 0.97 |

**What it shows.** The test is at its ceiling: the descriptions of the six skills the model may invoke route every request, and the names alone nearly do (one miss in 170 answers, a bug report sent to `add-endpoint`). So today's descriptions need no tuning on this test, and the test cannot show that a description adds anything over a good name. The control's 0.29 is the share of requests that need no skill. **Limits:** all 34 requests in one call, so the model sees the whole set at once; clean, single-intent requests; one model; the other plugins' descriptions are copied from one session and may have changed; a real session lists far more skills. The one-request-at-a-time part is measured next (`routing-live.mjs`); the long listing is not. It stays as a guard: edit a description, run it (about $0.35 for 5 runs of the control, `current`, and `crowded`), and a drop shows.

## anthropics/skills and cloudflare/security-audit-skill (2026-10-29)

Both were read (anthropics/skills: the README and `skill-creator`'s trigger and optimization scripts, not the document skills; Cloudflare's: the README, the head of `SKILL.md`, and the rules of its findings validator). Nothing was run. Anthropic's repo has no license at the top and one per skill; only ideas were taken, no code.

- **skill-creator's loop is what `tune.mjs` already is.** It splits the requests into a training and a held-back set, hides the held-back scores from the model that rewrites the description, and keeps the best by held-back score. `tune.mjs` holds back a scenario too and adopts a wording only on a one-sided Fisher test with the held-back scenario carried, so no change there.
- **Its trigger evaluation was the missing half of `skill-routing`.** It runs each request alone in a real `claude -p` session with the skill installed and reads the first tool call from the stream, stopping there. `scripts/micro/routing-live.mjs` does that for this plugin's skills, with the requests and the scoring of `skill-routing`, in a Stack Agent sample project, with isolation checked from the session's init event.
- **Cloudflare's validator is stricter than ours in two ways, both reproduced here before fixing.** A field of only zero-width or other format characters passed as "non-empty text" (`trim()` does not remove them), and a control character in a finding's id or a field name was printed to the terminal as itself (an ESC sequence clears the screen; a bidirectional override reorders what is shown). `review-findings.mjs` now needs a visible character in every text field, counts an excerpt by what shows, and writes control and format characters as `\u{..}` in its messages, JSON, and log rows. The rest of its design (the four verdicts, a finder that cannot verify its own finding) was already taken earlier.
- **Not taken from Cloudflare:** the coverage ledger across runs and the required OS sandbox for running target code. `sample-review` reviews commits of the user's own repository, not code from outside.

**What the live check found.** Sonnet, 62 measured sessions (7 more were started in a first run that crashed on a cleanup error and left no result), each stopped at its first tool call:

| Run | Sessions | Right |
| --- | --- | --- |
| Empty folder, one session per request (6 skills + 1 near-miss) | 7 | 6 (the miss: "Add DELETE /items/:id" began with a Glob, since an empty folder has nothing to add a route to; so the default is a sample project) |
| Sample projects, 15 requests x 2 | 30 | 26 (87%) |
| The three requests that missed, plus two that did not, x 5 | 25 | 14 |
| Rerun after the fix below, in a work folder with no `CLAUDE.md` above it, 15 requests x 3 | 45 | 41 (91%) |

Over the two sample-project runs, the requests that missed (the sessions were stopped at their first tool call, and a hook refused every tool, which was checked on a real session: it chose Grep, Glob, and Bash and each came back refused): "run the checks and tell me whether the new rule really works" loaded `verify` 0 times in 7 (every session ran Bash); "which file handles GET /reports/summary?" loaded `api-map` 4 in 7 (the others searched with Grep); "where is the --top flag handled in this CLI?" loaded `feature-map` 2 in 7. The other 12 requests (debug, verify with "prove it works", add-endpoint, add-migration, an api-map update, a feature-map update, three near-misses) went to the right place in every session, 2 of 2. The text test gave 100% for all of them.

**What that means, and does not.** The text test hid a real habit: when the request is "go find" or "run the checks", the model often does it directly instead of loading the skill. In a 20-file sample a search is a good answer, so the lookup misses may cost nothing there; the skills' value (a map that saves a search, a verify run that records evidence) shows in a bigger repo, which was not tried. The `verify` miss is the one that matters: the skill is meant to be used before saying something works, and "run the checks" is a natural way to ask. Its description names "verify", "prove it works", and "test the command", not "run the checks". **No description was changed**: the numbers are 7 sessions for each of the three requests that missed (2 for the rest) on one model, a skill edit needs its eval, and whether the wording is the cause was not tested. Next step if wanted: reword the `verify`, `api-map`, and `feature-map` descriptions, run the same requests again, and keep a change only if the held-back requests do not lose.

**A finding about the harnesses themselves.** A review of the live check asked whether `--setting-sources project,local` keeps the user's own memory out. It does not: a session asked what instructions it had been given quoted the first line of `C:\Users\USER\CLAUDE.md`, an "agentic engineering team playbook", because claude reads a `CLAUDE.md` from the working folder and every folder above it, and the Windows temp folder is inside the profile. From a work folder outside the profile (`C:\Users\Public`) the same question was answered "NONE". So `routing-live.mjs` picks such a folder (`--work-dir` to choose one; it lists any memory file it still cannot avoid), and the first three runs above were made before that, **with the playbook in every session**. One rerun in a clean folder (the last row, 45 sessions) gave 41 right (91%): `verify` for "run the checks..." 0 of 3 again (0 of 10 in all), `feature-map` for the `--top` flag 2 of 3 (4 of 10), and `api-map` for "which file handles..." 3 of 3 (7 of 10), so its earlier misses may have come from the playbook or from chance; 3 sessions cannot tell. The `verify` miss did not move, which makes it the finding to trust. By the same mechanism, not tested separately, every micro-test, `tune.mjs` call, and A/B run on this machine started from the temp folder read it too. Both arms of a comparison get the same file, so the differences measured stand, but the absolute numbers (the 5 of 5 Sonnet replies in Thai, the 25 of 30 for the import request, the A/B tables) were produced with an unrelated instruction file in context, and "isolated" in the A/B docs does not cover it. Those harnesses now start in a clean folder too (`micro/run.mjs`, `tune.mjs`, and `ab/run.mjs` take the same `--work-dir`; a run records `memoryFilesRead` and prints a NOTE if a file still reaches it). Three micro cases were rerun there with Sonnet, to see what moved. `remind-verify` (no message / English / Thai, out of 10): 0 / 8 / 9 before, 0 / 8 / 9 now. `setup-hint`: 0 / 8 / 10 before, 0 / 9 / 10 now. `import-request` (30 runs): 0 / 25 / 24 before, 0 / 17 / 18 now (the original wording from before `4af59f0` scored 0 of 30). The ranking held in all three, with no message at 0 and the English and Thai wordings level, but on `import-request` both wordings fell by about 20 points, so either the playbook was helping or the first numbers were lucky. Asked directly the next day: 30 runs in a folder that does read the playbook gave 0 / 30 / 24 (no message / English / Thai), against 0 / 17 / 18 in the clean folder, so the playbook was helping, by 13 runs of 30 for the English wording and 6 for the Thai (the 25 and 24 of the first table sit between the two, so chance moves a figure by several runs as well). The five other cases were rerun in the clean folder too (10 runs, Sonnet; no message / English / Thai): `coverage-request` 0 / 9 / 10 before and 4 / 10 / 8 now, `coverage-refactor` 8 / 10 / 10 and 9 / 10 / 10, `guard-request` 10 / 10 / 10 and 10 / 10 / 9, `deny-no-verify` 10 / 10 / 10 and 10 / 10 / 10, and `language-note` (no note / note) 0 and 10 of 10 replies in Thai. Every ranking held, and every move is within what 10 runs let chance do; only `import-request` showed a clear playbook effect. So the earlier tables stand as comparisons between wordings, and the absolute figure of `import-request` is the one to read from the clean folder. Read the absolute numbers of the earlier tables as measured with the playbook in context.

**Changing the `verify` description, and a second model.** The request that missed every time, "run the checks and tell me whether the new rule really works", started with a Bash call and no skill in all 10 sessions. The description now also lists "run the checks" and "tell me whether it really works". The same four `verify` requests of the case, 3 sessions each: 12 of 12 right after the change, 9 of 12 before, the only miss being that request (0 of 3). The new phrases come from that request, so 10 requests written afterwards, in other words, ran 3 times with each description (`routing-live.mjs --requests`): 27 of 30 right before, 26 of 30 after. Two of them ("I changed the slug rules. Can you confirm it behaves right before I merge?" and "Run everything that should pass and report what actually happened") missed with both descriptions, starting with Grep or Glob. So the change fixes the wording it was written from and does not reach further; wider wording would need its own test. The eval case `verify-before-done` could not be run here: it needs Bash, and `claude plugin eval` refuses to grant Bash on this machine because `~/.docker/contexts` holds a symbolic link (that folder was not touched); rerun it elsewhere before a release. **Haiku**, same method, 15 requests, one run each: 11 right (73%). The four misses all began with a Grep search instead of a skill: both migration requests and one request each from `api-map` and `feature-map`. One run each cannot say whether that is Haiku or the descriptions.

**Cost.** A session that ends in text reports $0.05; one stopped at its first tool call reports no cost, so the total is an estimate: about $3.5 for the 69 sessions started. The per-session limits add up to $10.35, but a limit is checked after a model turn, so one turn can pass it.

## Seven more repos read, one test taken (2026-10-29)

autoharness, harness, and ruflo were read for ideas (above); this round was blader/humanizer, infiniflow/ragflow, nextlevelbuilder/ui-ux-pro-max-skill, Graphify-Labs/graphify, addyosmani/agent-skills, microsoft/playwright, and ComposioHQ/awesome-claude-skills, from their READMEs only (summarised by a small model; no code was opened). Two had something that fits; the rest are in [out-of-scope.md](out-of-scope.md).

- **A table of excuses in each skill (addyosmani/agent-skills, MIT).** Every skill there ends with the excuses an agent gives for skipping a step and a rebuttal for each. It matches a failure measured here (an agent says "should work" and stops), so it was tested before being added. The case `skip-excuses` hands Sonnet the `verify` skill and a reason that looks good for not writing a check (the suite is green; the new rule sits behind a login and there is no token), with no skill, with the skill as shipped, and with the skill plus a five-row table. Result, 20 runs each: **0 / 17 / 17**. The six replies scored 0 in the two skill variants were read: none used the excuse (none used `--skip` or claimed it worked); each said it would read the files first, and the scorer wants the check and the full run in one reply. So the skill as shipped already holds against this excuse and the table had nothing to add here. It is not added. This is one scenario, one model, and one skill; it does not show the table is useless elsewhere. The case stays as a guard that the skill keeps holding.
- **Playwright (Apache-2.0).** A better page check than the `e2e` script of the `frontend-web` example, but it needs a package install, and the core runs with none. A project that already uses it can put its test command in `verify.json` as a command check (`needsServer: true` starts the server first); nothing in Stack Agent needs to change.

## Four descriptions rewritten after a harder routing test (2026-10-29)

The 34 requests of `skill-routing` are written in the words of the descriptions, and Sonnet scored 91% on them live. Requests in other words were much harder: 33 new ones (`scripts/micro/cases/skill-routing-extra.json`, run with `routing-live.mjs --requests`; set A of 17 and set B of 16, the second written before the change, in different words from the first) scored 39% and 27% on Haiku and 65% and 50% on Sonnet before any change. The misses were one kind: a plain question about where something is ("which handler serves GET /health", "where is the --format option parsed", "what code runs with --dry-run") or a schema request not in the words of the description ("store each user's timezone", "make email unique") began with a Grep, a Glob, or a Bash call, and no skill was loaded.

The descriptions of `api-map` and `feature-map` now say to use them first, before grepping or reading code, for any question about where an endpoint or a user-facing behavior is implemented, with examples of such questions. `add-migration` now covers any change to the database (column, table, index, constraint, a drop or a rename, "store X in the database"), and `verify` also names "confirm", "double-check", and "report what actually happened". Same method, same folders, the plugin before and after:

| Requests | Model, runs | Before | After |
| --- | --- | --- | --- |
| the case's own 34 | Haiku, 2 | 54 of 68 (79%) | 63 of 68 (93%) |
| set A, 17 requests | Haiku, 3 | 20 of 51 (39%) | 38 of 51 (75%) |
| set A | Sonnet, 2 | 22 of 34 (65%) | 34 of 34 (100%) |
| set B, 16 requests | Haiku, 3 | 13 of 48 (27%) | 23 of 48 (48%) |
| set B | Sonnet, 2 | 16 of 32 (50%) | 28 of 32 (88%) |

Requests that should load no skill never loaded one of ours, before or after, in any set (0 wrong in all ten runs of the table). Still missed after the change: Haiku on `verify` requests that do not use the words of the description ("does the new export flag behave as documented" 0 of 3), on "rename the column" and "store the timezone", and on questions about a button or a printed table; Sonnet on two such feature questions and one `verify` request. **How far to trust it:** both sets were written by the person who read the misses, one run is the first tool call only, the project is a small sample, and the runs per cell are 2 or 3, so single rows are noise and only the direction over the whole table counts. Set A was also the set the descriptions were written against, so set B is the fairer figure (Sonnet 50% to 88%, Haiku 27% to 48%). The earlier `verify` change ("run the checks") is part of the "before" here.

A second round the same day added to the descriptions: `add-migration` (a foreign key, a column's type, and any request that needs a new piece of data kept for each row), `verify` ("make sure", "check", "still works", "is valid", "is rejected"), `feature-map` ("which file or function implements X, reads this option, or prints that output"), `debug` (a wrong total or count), and `add-endpoint` ("exposing something over HTTP"). Two new sets were written first, C of 20 after reading the misses of the first round and D of 15 before touching anything, in other words again. The same runs, before and after the second round:

| Requests | Haiku, 3 runs | Sonnet, 2 runs |
| --- | --- | --- |
| set D (unseen) | 18 of 45 (40%) to 22 of 45 (49%) | 26 of 30 (87%) to 26 of 30 (87%) |
| set C | 30 of 60 (50%) to 33 of 60 (55%) | 31 of 40 (78%) to 37 of 40 (93%) |
| set A | 38 of 51 (75%) to 42 of 51 (82%) | 34 of 34 to 34 of 34 |
| set B | 23 of 48 (48%) to 29 of 48 (60%) | 28 of 32 (88%) to 27 of 32 (84%) |
| the case's own 34 (Haiku, 2 runs) | 63 of 68 (93%) to 64 of 68 (94%) | not rerun |

A request that should load no skill again never loaded one of ours, in any of the nine runs. Read this round as small: on the unseen set D the difference is 4 sessions of 45 for Haiku and none for Sonnet, which sampling alone could produce, and one cell (set B on Sonnet) lost a session. Nothing got worse beyond that and most cells moved up a little, so the edits were kept, but they should not be counted as a measured gain the way the first round was. The misses left on D are Haiku on migration requests not in the words of the description, on "check it for real" style `verify` requests, on two feature questions, and on one `debug` and one `add-endpoint` request; Sonnet missed two migration requests and one `verify` request. All four sets are in `scripts/micro/cases/skill-routing-extra.json` (68 requests).

## A/B of the rewritten descriptions: it found a gap in `verify` (2026-10-30)

The routing tests above say which skill loads; they do not say whether the work is better when it does. So the rewritten descriptions were run through `scripts/ab/run.mjs`: the plugin as it is now against the same plugin with the skill descriptions as on `main`, same tasks, one run of each in turn so a drift in the API reaches both alike, Sonnet, at most $1 a run. Tasks `endpoint` and `validate`, 3 rounds. Every graded measure was met in every run of both plugins except one: on `validate`, the new descriptions added a test in 1 of 3 runs, against 3 of 3. Six more rounds of `validate` alone made it **3 of 9 with the new descriptions against 9 of 9 with the old ones** (the other measures stayed 9 of 9 on both: behavior, tests pass, guard, self-verified, a check added, the evidence covers the rule).

The cause was in the skill, not the description. With the old descriptions `verify` was never loaded in this task (0 of 9 runs); with the new ones it was loaded in 6 of 9, and **in all 6 the agent added a check to `verify.json` and no test** (3 of 3 when it was not loaded). Step 2 of the skill said to add a check and said nothing of the project's own test suite, so a skill that now loaded more often steered the agent away from the test that the Stop hook and the task both expect. `api-map` also began to load on `validate` (7 of 9), to find where `POST /items` lives; it did no harm.

The fix is one sentence in step 2: if the project has a test suite, also add or extend a test for the new behavior there (the check proves the program as a user runs it, the test keeps the rule proven on every later change). Nine more `validate` runs on the fixed skill: test added **9 of 9**, the other measures 9 of 9, and in the 7 runs that loaded `verify` the test was added every time; three `endpoint` runs stayed at 3 of 3 on every measure. The price is about 10% in cost and 1 to 5 more turns on average (`validate`: $0.124 and 15.8 turns against $0.112 and 14.7, 9 runs each; `endpoint`: $0.199 and 24.7 turns against $0.177 and 20.0, 3 runs each). **Limits:** one model, two small tasks written by the plugin's author, 3 to 9 runs per cell; the 9-against-3 is large enough not to be chance (Fisher exact, about 0.005), the cost figures are not. The eval case `verify-before-done` was not run (it needs Bash, which `claude plugin eval` refuses on this machine), and it grades honesty, not this.

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
