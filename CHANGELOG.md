# Changelog

What changed in each release of Stack Agent. Bump `version` in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `package.json` together, and add a section here.

[ภาษาไทย](CHANGELOG.th.md)

## Unreleased

### Fixed

- The guard and the API map read only the files git would commit, so a gitignored `.env` or key file no longer fails the guard locally while CI passes, and `--update-baseline` no longer writes its name into the committed baseline. A baseline that already lists such a file shows it as `improved`; run `--update-baseline` to drop it. Outside git, every file is scanned as before.
- Files over 1 MB that a rule covers are named in a warning instead of being skipped silently.

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
