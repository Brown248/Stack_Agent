# Changelog

What changed in each release of Stack Agent. Bump `version` in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `package.json` together, and add a section here.

[ภาษาไทย](CHANGELOG.th.md)

## Unreleased

### Upgrading

- `guard.mjs`, `verify.mjs`, `api-map.mjs`, `lib/files.mjs`, and `lib/fingerprint.mjs` changed and `feature-map.mjs` is new, so rerun `init` in each project to refresh `.stack-agent/bin/`. Until you do, the SessionStart hook names the stale files.
- A subfolder project in a monorepo: rerun `init`, then delete the `.github/workflows/stack-agent.yml` inside the subfolder. `init --check` names it.
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
- A plugin icon.

### Changed

- The `debug` skill's description leads with bug reports and "find and fix it", after the A/B runs found it was never picked up from a plain bug report. In the A/B run of 2026-10-23 it was picked up in 9 of 9 bug-report runs, against 0 of 9 before.
- When the changed tests import something the code before the change lacks (a new export or module) and no new check was added, the against step says so and what to add, records `importMissing`, and the Stop hook asks once for a verify check that runs the program as a user does. In the A/B run of 2026-10-23 this case left all three `job-skip-blank` runs without proof that their tests catch the change.
  The request names the imports verify read from the test output (`missingImports`) and, for code nothing calls yet, shows a command check that calls the new function directly. Its first wording offered "if nothing a user can run reaches this change, say so and stop", and in the `job-new-export` A/B run all 4 agents that met it took that way out.
- When the code changed but no check or test is new or changed, the against step says so and records `noNewCoverage`, and the Stop hook asks once for a test or check, or for the agent to say nothing a user can observe changed. In each `job-new-export` A/B round one agent changed the code, wrote no test, verified, and stopped.
- The shell hook's git rules (`--no-verify`, force-push, `reset --hard`, branch deletes, and the rest) apply only inside a project with `.stack-agent/verify.json` or `.stack-agent/guard.config.json`, so a plugin installed for your user account no longer changes other repositories. The rules about Stack Agent's own files still apply everywhere.

### Fixed

- The CI template ran on pushes only to `main`, so a repository whose default branch is `master`, `develop`, or anything else got CI on pull requests only. `init` now writes the default branch from `origin/HEAD`; without it, `init --check` notes that the branch is not known yet. `--check` also notes an existing workflow whose `branches` leaves out the default branch.
- The guard and the API map read only the files git would commit, so a gitignored `.env` or key file no longer fails the guard locally while CI passes, and `--update-baseline` no longer writes its name into the committed baseline. A baseline that already lists such a file shows it as `improved`; run `--update-baseline` to drop it. Outside git, every file is scanned as before.
- The after-edit guard runs on NotebookEdit too.
- On Windows, in a project with a long path, the against step skipped with "verify.json does not exist" although it did: `git show <full hash>:<path>` also tried the argument as a file name and passed the 260-character limit. Every `git show <rev>:<path>` now ends with `--`, and an error other than a missing file is reported as such.
- `evals/scaffold.mjs` (used by the evals and the A/B harness) left out every example's `data/` folder, which holds `sample-generic`'s input CSV, so verify could never pass in a scaffolded copy of it. Only database files in `data/` are left out now.
- Files over 1 MB that a rule covers are named in a warning instead of being skipped silently.
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
