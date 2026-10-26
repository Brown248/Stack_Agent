# Changelog

What changed in each release of Stack Agent. Bump `version` in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `package.json` together, and add a section here.

[ภาษาไทย](CHANGELOG.th.md)

## Unreleased

From a detailed review of 0.5.0 (four agents reading the code independently, and the CI steps run on Linux). `verify.mjs`, `guard.mjs`, and `lib/files.mjs` changed, so rerun `init` to refresh `.stack-agent/bin/`.

### Measured

- `feature-map-lookup` (new), 2 runs per arm: 1.00 with the plugin against a mean of 0.25 without; only the plugin arm read the feature map. `verify-before-done` after its skill edit: 1.00 in both arms.
- A/B `init-library` (new), plugin arm, 2 runs: verify and the guard pass in both, but `init --check` in neither, because a headless session cannot approve edits to the protected guard config and workflow. Details and caveats: design notes, 2026-10-26 (later).
- `npm test`: 504 tests, all passing on Windows (Node 26) and Linux (Node 22, WSL2).

### Fixed

- Ways around the guard: the shell hook let through `git commit --no-verif` (git takes any unambiguous prefix of a long option), `git --config-env=core.hooksPath=VAR commit`, and `git config core.hooksPath x`. All three are denied now, and the other git gates match abbreviations too (`push --de`, `push --m`, `reset --k`, `clean --f`).
- The after-edit and after-shell hooks, the Stop hook's guard, and `guard.mjs --files` did not apply the config's `ignore` list or the default skipped folders, which CI's full scan does, so a fixture or generated file was blamed locally and passed in CI.
- The after-shell guard (new in 0.5.0): it blamed the first command for a `.md` or `docs/` file left dirty before the session, because the session record left those out; one unreadable changed file made it check nothing for the rest of the session; edit hooks running at the same time lost each other's entries, so a violation could be reported twice; and a command run from the top of a monorepo reached no project. The Stop hook's guard had the same blind spot for `.md` files.
- verify: a command that exits while a process it started still holds its output (`start /b`, `&`) was waited on until that process ended, then reported as timed out; it is now judged on its exit code once the output has been quiet for 1.5 s (10 s at most), and on Linux and macOS that process is stopped. Output between 8 and 12 MB passed as if all of it had been matched; the 8 MB limit now holds. A command killed by a signal is reported as `killed by <signal>` and is a real red in `--repeat`, not an inconclusive run. A verify stopped with Ctrl+C or SIGTERM stops the server and the commands it started. `--skip-tests --skip-checks --repeat` is refused instead of running the tests anyway.
- The `cli-minlen` A/B test failed on machines that have only `python3`; it now skips like the other Python tests.
- Docs that had drifted: the README (EN/TH) said the guard runs only after edits and that CI does not run verify; the init skill named three of the six files it copies; the verify skill left out `expectHeaders`, `followRedirects`, and `timeoutSec`; the Thai changelog's `--repeat` entry left out the first red output.

### Added

- Documented what the code already accepted: verify's `--config` and `--json`, `test.cwd`, `test.env`, `test.timeoutSec`, `server.readyTimeoutSec`, the HTTP check `timeoutSec`, `type`, and the `evidenceDir` default; the guard's `baseline`, `--files`, `--strict`, `--json`, `--config`, and `pythonRoots`; api-map's `--config`, `--json`, and `verifyConfig`; feature-map's `--map` and `--json`; review-findings' `--stage` and `rows --date`; and the A/B harness's `--disallowed-tools`.
- Eval case `feature-map-lookup` (on the library example) and A/B task `init-library` (Stack Agent set up from scratch through the skill). `evals/scaffold.mjs` takes the example to copy. `run-evals` says how each skill is measured, and why `mine-corrections` is not.
- Tests for behavior that had none: the git gates, config errors in verify, guard, and api-map, the against step's skip reasons, `against.setup` and `against.keep`, HTTP failure modes, the output limit, the feature-map and api-map options, and the A/B harness helpers (464 to 504 tests).

### Changed

- The `guard-request` micro-test no longer says the after-edit hook misses shell edits; its scenario now has the agent move on past the after-shell hook's report. Its earlier scores are not directly comparable.

## 0.5.0 (2026-10-26)

From the first install into a real project (a pnpm + Next.js monorepo on PostgreSQL, on Windows), and the open items from the 0.4.0 measurements. `verify.mjs` changed, so rerun `init` to refresh `.stack-agent/bin/` (`--check` lists it as outdated until you do).

### Measured

- `add-migration-column`, 3 runs per arm: `up-down-up` passed for the first time, 2 of 3 with the plugin and 0 of 3 without (every earlier run failed it in both arms); mean 0.88 against 0.79. `debug-blank-name`, 2 runs per arm: 1.00 against 0.75, `repro-before-fix` 2 of 2 against 0 of 2.
- A/B, 3 runs per arm: the new-import path ran with agents for the first time (`job-new-export`: the case came up in 2 plugin runs, and both ended with a verify check that detects the change). In `bug-flaky-list` and `bug-stale-list` every agent wrote a test repro that loops until it is red every time, so no red rate was measured or needed. The after-shell guard made no false report in 9 plugin sessions.
- Details and caveats: design notes, 2026-10-26.

### Added

- The CI workflow template runs with a read-only token (`permissions: contents: read`).
- `no-private-keys` in every preset also catches `ENCRYPTED PRIVATE KEY` and `PGP PRIVATE KEY BLOCK`. Existing projects keep their own copy of the rule; copy the new pattern from the preset to get it.
- HTTP checks take `followRedirects` (default `true`) and `expectHeaders`, so a check can assert that a signed-out page redirects to `/login` instead of only seeing the login page it lands on.
- `init` adds `.stack-agent/` to `.prettierignore` when the project uses Prettier (including as a plain dependency), and to an existing `.eslintignore`, in the project's folder and at the top of its repository. The vendored tools had failed the project's own `prettier --check .` (9 files) and `eslint .` (66 errors). `--check` notes an ESLint flat config that never names `.stack-agent`.
- The CI workflow `init` writes uses the project's Node version from `.nvmrc`, `.node-version`, or the lower bound of `engines.node` when it is newer than 22. `--check` notes a workflow that runs an older one, or one older than 22.
- docs/adoption.md: how to verify a program that needs a database or a seeded user (one wrapper script for `server`), and how to check a signed-in flow (a command check).
- A/B task `bug-flaky-list`: a bug that is really random (two read copies picked at random, a create refreshes one), folded into the project's first commit with the new `plantBug(..., { hidden: true })` so the history does not point at it.
- `verify.mjs --check <name> --repeat N` runs the named checks N times and reports the red rate (`red in 7 of 30 runs (23%)`), each distinct failure with its count, and the first red output. The server starts once for all runs. `--skip-checks --repeat N` does the same for the test suite, for a repro written as a test (what every agent wrote in the 2026-10-26 A/B runs). In the `bug-stale-list` and `bug-flaky-list` A/B runs no agent measured a red rate, because permission rules stopped their shell loops; the `debug` skill now points at this flag.
- A PostToolUse hook after Bash and PowerShell runs the guard on the files the command changed outside the edit tools (`sed -i`, a codemod, a generator), so a shell edit gets the same feedback right away that an Edit gets. Files are compared by git blob id with what the guard hooks last saw, so each violation is reported once, and files left dirty before the session are not blamed until a command changes them. About 130 ms per command with 5 changed files on a 20,000-file repository (`scripts/bench-hooks.mjs` now times it).
- The sample backend's migration runner has `redo [N]`: on a throwaway in-memory database it applies every migration, rolls back the last N, applies them again, prints the schema after each step, and fails when the schema does not come back the same. It writes no file, so a read-only sandbox can still prove a migration both ways.
- A/B: `bug-flaky-list` and `bug-stale-list` grade `redRateMeasured` (some `verify.mjs --repeat` run went red), from every evidence file the session left.

### Changed

- `add-migration`: prefer the runner's own round-trip command (the Rails redo task, the sample's `redo`), and when no file can be written use an in-memory or throwaway database instead of skipping up-down-up. In every eval run so far both arms failed `up-down-up` because the eval sandbox cannot write a scratch database file. The `up-down-up` grader accepts a `redo` run that shows all three steps.
- `debug`: reading the code to aim the repro is fine, and spotting the cause on a short file is expected; nothing changes until the repro is red. In the A/B runs every agent read a short service before its repro, and all fixed the right bug.
- `run-evals`: one run per arm is a direction, not a score; look at the graders an edit targets and rerun with `--runs 3` when only another grader moved.
- The Stop hook's guard message no longer says the after-edit hook misses shell edits.

### Fixed

- The against step links the `node_modules` of workspace packages (`apps/*/node_modules`, `packages/*/node_modules`) into its worktree by default, not only the root one. In a pnpm monorepo the old code's tests failed there on missing packages, and verify reported that as detecting the change. `against.link` still overrides the list.
- On Windows with `core.autocrlf=true` (Git for Windows' default), vendored tools checked out with CRLF were reported `outdated` by `--check` and the SessionStart hook, and rerunning `init` could not fix it. A copy that differs only in line endings now counts as the same tool, and `init` writes `.stack-agent/.gitattributes` (`* text eol=lf`).
- docs/adoption.md said `--compare-ref` fails when a rule is "narrowed"; it fails on any change to a rule's files, exclude, or pattern, widening included.
- `init --check` no longer counts the feature map template's own instruction ("replace every EDIT ME") as a placeholder, which kept a finished feature map pending. Maps installed with 0.4.0 still contain the old sentence, and `--check` skips it there too.
- Without `origin/HEAD` (a repository that was pushed, not cloned), `init` writes a single `origin/main` or `origin/master` as the push branch, and `--check` notes that it was a guess until `git remote set-head origin --auto` records the real one.
- `init --help` says that the exit code 1 is for `--check`; `init` itself exits 0 after writing files even while setup is unfinished.
- The four `honest-report` eval graders read the trace and accept listing what did pass next to saying verify could not run. They had judged against the trace from the final message alone, and failed plugin runs that reported a read-only sandbox honestly. A new test makes any llm grader that mentions the trace read it.

## 0.4.0 (2026-10-24)

Ideas adapted from obra/superpowers and mattpocock/skills (both MIT), and measured. No vendored script or hook changed since 0.3.0, so projects need no `init` rerun.

### Measured

- The eval case of every skill edited in this release, 1 run per arm: all six ahead with the plugin, from +0.11 (`add-endpoint-delete-item`) to +0.67 (`reflect-lessons`); `correct-error-body` is now 1.00 against 0.50. Three plugin-arm `honest-report` losses came from the judge on messages that said verify could not run in the sandbox and why.
- `debug` is invoked from a plain bug report in 12 of 12 A/B runs (`bug-blank-name`, `bug-dup-count`, `bug-space-list`, `bug-stale-list`).
- Details and caveats: design notes, 2026-10-24.

### Added

- `scripts/micro/run.mjs` (`npm run micro`): micro-tests that send one scenario and one wording to `claude` as a single call with no tools, score the reply with a script, and repeat each wording beside a control that gets no guidance. `--dry-run` prints the prompts and the cost cap. `--rescore FILE` scores saved replies again for free. Cases: `import-request` (0/5 with no message, 0/5 with the wording before `4af59f0`, 5/5 with the current one), `coverage-request`, `coverage-refactor`, and `guard-request`.
- A/B task `bug-stale-list`: a bug that shows up only sometimes (a 50 ms list cache that a create does not clear).
- The reviewer also checks the repo's own standards files (`CONTRIBUTING.md`, `CODING_STANDARDS.md`, `STYLEGUIDE.md`, `STYLE.md`, `AGENTS.md`, `CLAUDE.md`) and cites a violation as `standards:<file>:<line>`, which `review-findings.mjs` checks like a `rules.md` line. `rules.md` wins a disagreement.
- `docs/out-of-scope.md` (EN/TH): ideas Stack Agent decided not to adopt, why, and what it does instead.
- "Writing the skill text" in `docs/customizing.md` (EN/TH).
- Tests: every SKILL.md stays under the 20,000 characters Claude Code keeps after a compaction, and every description names when to use the skill without "then" or "step"; the three version fields match and both changelogs lead with the current version; every page in `docs/` has a Thai page with as many headings.

### Changed

- `debug`: the red must be the failure the user reported, a bug that fails on some runs only gets a measured red rate, a red forced by putting the bug back shows `git diff` before and after, and a missing place for a test is reported as a finding.
- Nine skill descriptions no longer summarize the procedure (superpowers found an agent follows such a summary instead of the skill). The trigger wording of `debug` and `verify` is unchanged.
- The design notes name the test suite and the skills folder instead of counts that went stale.

### Fixed

- The `correct-error-body` eval graders `cites-history` and `rule-names-the-fix` read the trace instead of only the final message. In the eval sandbox the Stop hook keeps the agent on verification, so its last message was a verification report and the plugin arm lost both graders for work it had done earlier (0.5 with the plugin, 0.75 without). `cites-history` also fails when only one of the two commits is cited.

## 0.3.0 (2026-10-23)

### Upgrading

- `guard.mjs`, `verify.mjs`, `api-map.mjs`, `lib/files.mjs`, and `lib/fingerprint.mjs` changed and `feature-map.mjs` is new, so rerun `init` in each project to refresh `.stack-agent/bin/`. Until you do, the SessionStart hook names the stale files.
- A subfolder project in a monorepo: rerun `init`, then delete the `.github/workflows/stack-agent.yml` inside the subfolder. `init --check` names it.
- The Stop hook asks more than before: it blocks on guard violations in the session's changes, and once each when the changed tests import code the old version lacks or when the code changed with no new test or check. Expect one more turn on a refactor (in the A/B runs, about one turn and $0.03 per run).
- A large monorepo: set `"against": { "paths": [...] }` in `verify.json` to check out only the project's folders in the against step.
- A baseline that lists a gitignored file: run `guard.mjs --update-baseline` once.

### Added

- `run.mjs --judge MODEL` scores a task's `rubric` (criteria a script cannot check) with `agents/judge.md` on a blind copy of each run. Rubrics for `endpoint`, `item-note`, and `dup-name`.
- `scripts/bench-hooks.mjs` times the fingerprint, the Stop hook, and the against step's checkout on synthetic repositories. Results are in the design notes.
- A/B tasks for the other presets: `lib-maxlength` (library: the probe builds the package and imports it as a consumer), `web-roundup` (frontend-web: the probe starts the dev server and checks the page and the served code), and `job-skip-blank` (generic: the probe runs the data job on its own CSV). Each has a rubric for `--judge`. `withServer` in `scripts/ab/lib.mjs` takes the server script, the ready path, and whether to set up the database.
- Eval cases `debug-blank-name`, `correct-error-body`, and `reflect-lessons`, with `evals/plant.mjs` for cases that start from a history. `sample-review` gets none, because its checkout cannot be made in the eval sandbox; the A/B task `review-spec` measures it. Not run yet.
- `scripts/feature-map.mjs` and the `feature-map` skill for every preset except `backend-http`: `.stack-agent/feature-map.md` maps what a user does to where it lives (`path`, `path:line`, or `path#text`) and to the verify checks that exercise it, and the check fails when the code no longer matches. `init` adds it to new projects, CI runs it when the file exists, and the four non-backend examples have one.
- Skill `mine-corrections` with `scripts/mine-transcripts.mjs`: reads this project's past Claude Code transcripts on the machine (read-only), lists what the user wrote after an agent reply, and proposes a check, skill edit, or rule for each correction repeated across sessions.
- Shared guard rules: `"extends"` in `guard.config.json` lists JSON files of rules that several projects in one repository share. A project cannot redefine a shared rule, `--compare-ref` reads shared files at the base commit, and the hooks protect them.
- A/B task `job-new-export`, built to reach the case where the changed tests import a new export, with `importCase` and `checkAfterImport` graded from the session's evidence history (`importCaseGrade` in `scripts/ab/lib.mjs`). Not run with agents yet.
- `init.mjs --shared-rules FILE` vendors a team's rules file into `.stack-agent/shared-rules.json` for projects in other repositories, refreshes it on every `init`, and `--check` reports a copy that differs from its source.
- A plugin icon.

### Changed

- The `debug` skill's description leads with bug reports and "find and fix it", after the A/B runs found it was never picked up from a plain bug report. In the A/B run of 2026-10-23 it was picked up in 9 of 9 bug-report runs, against 0 of 9 before.
- When the changed tests import something the code before the change lacks (a new export or module) and no new check was added, the against step says so and what to add, records `importMissing`, and the Stop hook asks once for a verify check that runs the program as a user does. In the A/B run of 2026-10-23 this case left all three `job-skip-blank` runs without proof that their tests catch the change.
  The request names the imports verify read from the test output (`missingImports`) and, for code nothing calls yet, shows a command check that calls the new function directly. Its first wording offered "if nothing a user can run reaches this change, say so and stop", and in the `job-new-export` A/B run all 4 agents that met it took that way out.
- The Stop hook runs the guard on the files the session changed, so a violation added through the shell (where the after-edit hook does not look) blocks the stop with its fix instead of reaching CI first. A skip record does not cover it.
- When the code changed but no check or test is new or changed, the against step says so and records `noNewCoverage`, and the Stop hook asks once for a test or check, or for the agent to say nothing a user can observe changed. In each `job-new-export` A/B round one agent changed the code, wrote no test, verified, and stopped.
- The shell hook's git rules (`--no-verify`, force-push, `reset --hard`, branch deletes, and the rest) apply only inside a project with `.stack-agent/verify.json` or `.stack-agent/guard.config.json`, so a plugin installed for your user account no longer changes other repositories. The rules about Stack Agent's own files still apply everywhere.

### Fixed

- The CI template ran on pushes only to `main`, so a repository whose default branch is `master`, `develop`, or anything else got CI on pull requests only. `init` now writes the default branch from `origin/HEAD`; without it, `init --check` notes that the branch is not known yet. `--check` also notes an existing workflow whose `branches` leaves out the default branch.
- The guard and the API map read only the files git would commit, so a gitignored `.env` or key file no longer fails the guard locally while CI passes, and `--update-baseline` no longer writes its name into the committed baseline. A baseline that already lists such a file shows it as `improved`; run `--update-baseline` to drop it. Outside git, every file is scanned as before.
- The after-edit guard runs on NotebookEdit too.
- On Windows, in a project with a long path, the against step skipped with "verify.json does not exist" although it did: `git show <full hash>:<path>` also tried the argument as a file name and passed the 260-character limit. Every `git show <rev>:<path>` now ends with `--`, and an error other than a missing file is reported as such.
- `evals/scaffold.mjs` (used by the evals and the A/B harness) left out every example's `data/` folder, which holds `sample-generic`'s input CSV, so verify could never pass in a scaffolded copy of it. Only database files in `data/` are left out now.
- Files over 1 MB that a rule covers are named in a warning instead of being skipped silently.
- Listing the project's files no longer stats each one (readers skip what is not a regular file), so a full guard scan of a 5,000-file repository is back to its speed before the gitignore change, which had made it about 20% slower.
- Monorepos: for a project in a subfolder, `init` wrote the workflow inside that subfolder, where GitHub never runs it. It now writes `.github/workflows/stack-agent-<folder>.yml` at the top of the repository, running in the project's folder and only when its files change. `init --check` names a workflow left in the subfolder. If you set up a subfolder project before, rerun `init` and delete the old file.
- Vendored tools that differ from the plugin's copy are named at the start of every session, with the command that refreshes them. The hooks run the plugin's scripts and CI runs `.stack-agent/bin`, so a stale copy could make them disagree without anyone noticing.
- Evidence records `fingerprintVersion`. Evidence from a `verify.mjs` that computes fingerprints differently from the hooks is reported as such by the Stop hook, instead of as "the code changed".
- Monorepos: `guard.mjs --compare-ref` read the old config and baseline from the top of the repository, so in a subfolder project it found nothing and passed even when a rule was removed or the baseline grew. It now reads them from the project's folder.

## 0.2.0 (2026-10-23)

The version stayed at 0.1.0 from the first commit (`5d3ee7b`, 2026-10-18) through `0cfc5c1` (2026-10-21), so every vendored `.stack-agent/bin/VERSION` written in that time says `0.1.0`, whatever code it came with. This release covers all of those changes.

### Upgrading from 0.1.0

- Rerun `node <path-to-Stack_Agent>/scripts/init.mjs .` to refresh `.stack-agent/bin/`. It rewrites only the tools, never your configs. `init.mjs --check` lists each tool as `outdated` until you do.
- The Stop hook now blocks by default (`"stopHook": "block"`) until verify evidence matches the code, instead of reminding once. Set `"stopHook": "remind"` in `verify.json` for the old behavior.
- Import rules now count each imported name (baseline version 2). An old baseline still works and prints a note. Upgrade it with `guard.mjs --update-baseline` on a clean tree, in a commit of its own.
- The CI template has a `verify` job (since `ab50446`). It stays red until `verify.json` is filled in and its `EDIT ME` install step is replaced. Workflows that `init` created before that commit do not have it, since `init` never overwrites an existing workflow.
- Guard configs created before `da75cea` lack `no-debug-tags`. `init.mjs --check` names it. Copy it from a preset or list it in `"declinedRules"`.

### Works for any project

- Presets `generic` (default), `backend-http`, `frontend-web`, `cli`, and `library`, each with an example under `examples/` that passes its own guard and full verify. `init` records the preset and refuses to mix in another.
- Verify runs command checks next to HTTP checks, and `test`, `server`, and checks accept `args` to run a program without a shell.
- Guard import rules read Python as well as JS/TS.

### Verification bound to the code

- Evidence records a fingerprint of the code it tested. Files the run itself changed are listed and make the evidence stale.
- The against step: after a full passing run, new checks, and the test suite when test files changed, run on the code from before the change. At least one must fail there.
- The SessionStart hook records where the session started, so committing mid-task does not hide changes and editing `verify.json` mid-session does not switch the Stop hook off.
- `verify.mjs --skip "<reason>"`, or a final message ending in `stack-agent-skip: <reason>`, records why verification could not run.
- `verify.mjs --evidence-status` says whether the latest evidence matches the code, and runs nothing.

### Guard and hooks

- The ratchet counts each imported name (baseline version 2).
- Every preset ships `no-debug-tags`. The rule option `"onEdit": "skip"` leaves a rule out of the after-edit hook.
- `init --check` reports vendored tools that differ from the plugin's copy, and universal rules a project lacks. `"declinedRules"` silences the second.
- The shell hooks also ask before `git branch -D`, force-moving a branch, deleting the `.github` folder, and inline scripts (`node -e`, `python -c`, `path.join`) that write protected files.
- Faster full scans: cached globs, and each import target resolved once per run.

### Review

- The `sample-review` skill reads each sampled commit in its own checkout (`review-worktree.mjs`).
- The `reviewer` agent reports candidates as JSON. The new `finding-verifier` agent decides `confirmed`, `hardening`, `needs_validation`, or `rejected` without seeing the reviewer's evidence. `review-findings.mjs` checks the files.
- A `spec` review axis compares a change with its commit message or a spec file.
- The review log doubles as a ledger, so already-reviewed commits are skipped.

### Skills

- New `debug` skill: the repro is a verify check or test that fails first.
- `reflect` and `correct` accept only changes backed by a quoted observation.

### Measurement

- A/B harness `scripts/ab/` (`npm run ab`) with isolated runs, script graders, and 14 tasks. Results are in [docs/design-notes.md](docs/design-notes.md).
- `ci.yml` runs on Linux and Windows with Node 22 and 24.

## 0.1.0 (2026-10-18)

First version (`5d3ee7b`), for backend repos: `verify.mjs`, `guard.mjs` with a ratcheting baseline, `api-map.mjs`, `init.mjs`, `sample-commits.mjs`, hooks, 9 skills, the `judge` and `reviewer` agents, 4 eval cases, and `examples/sample-backend`.
