# Changelog

What changed in each release of Stack Agent. Bump `version` in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `package.json` together, and add a section here. Pushing the tag `vX.Y.Z` then makes the GitHub Release from that section (`.github/workflows/release.yml`).

[ภาษาไทย](CHANGELOG.th.md)

## 0.6.0 (2026-10-30)

No tool in `.stack-agent/bin/` changed, so there is no need to rerun `init`; the hooks and skills change when the plugin updates.

### Added

- A release is made by pushing its tag: `.github/workflows/release.yml` checks the tag against the version in `plugin.json`, `marketplace.json`, and `package.json` and against the newest section of both changelogs (`scripts/release-notes.mjs`, which lists every mismatch), then creates the GitHub Release from the changelog section with a link to the Thai changelog, or updates it if it exists. It marks the Release Latest only when the tag is the highest version, and a tag with a `-` suffix is a pre-release. The check also runs on pull requests that touch the version files or changelogs, so a slip shows before the tag, and by hand with a dry run by default. Only the publish job can write. Run against v0.5.1, v0.5.2, and v0.5.3, the script gave the same notes and title as the Releases made by hand (blank lines aside) and marked only v0.5.3 Latest. This repo's own tooling; nothing a project installs changed.
- Messages in plain Thai, opt-in: set `"language": "th"` in `.stack-agent/verify.json` or `STACK_AGENT_LANG=th` and the SessionStart notice about outdated tools and the Stop hook's release messages are in Thai, and SessionStart adds a note to the agent's context that the reader prefers plain Thai. The default is English, word for word as before. The guard's messages, the denials, and the evidence files stay English (the permission questions and three reminders to the agent are Thai too; see the next entry). With the note, 5 of 5 Sonnet replies to an English question were in plain Thai against 0 of 5 without it (`scripts/micro/cases/language-note.mjs`). The hooks that ship with the plugin read the setting, so no `init` rerun is needed.
- With `language: th`, the 13 permission questions (force-push, `git reset --hard`, a change to the guard rules, a hand-written evidence file, ...) are asked in Thai, and three of the Stop hook's reminders to the agent (the main one, the coverage request, the import request) are in Thai. The questions are shown to the person, so they cost the agent nothing; each reminder is used in Thai only because a micro-test on Sonnet found the agent followed it as often as the English one (reminder 9 of 10 against 8 of 10, coverage 10 against 9, import request 24 of 30 against 25; no message at all: 0 in each). "No difference found" with 10 to 30 runs, not "the same": a drop of 15 to 20 points can go unseen. The guard failure reminder and the denials have a Thai text but are not used, because their cases showed nothing (the agent does the right thing with no message). English is word for word as before, pinned by tests made from the old code. Thai costs about twice the tokens. The hooks read the setting, so no `init` rerun is needed.
- `scripts/micro/tune.mjs` (`npm run tune`), this repo's tooling: searches for a better wording of one message by having opus propose rewrites, haiku screen them, and sonnet measure the best against the original and against no guidance on scenarios including one held back. It proposes in `proposed.txt` and never edits a file. From a wording that scored 0 of 60 it proposed one that scored 42 of 60 (17 of 20 on the held-back scenario), for $5.19 and about 36 minutes; a hand-tuned wording still scored higher on the first scenario (83% against 65%), so it has not beaten careful work by hand. Nothing a project installs changed.
- `scripts/skill-usage.mjs`: counts from the transcripts Claude Code keeps which skills this project's past sessions loaded, ran as a slash command, or only read (`--days`, `--worktrees`, `--skills`, `--min-sessions`, `--json`), and lists the ones nobody used ("not used so far" below 10 sessions, "not used" from 10). It adds no hook and no state, and it only reports. A resumed session repeats the history it continues, so each event is counted once and a file with nothing new is not another session; a skill with the same name in two plugins counts as one. The idea is from autoharness, which counts in a file per skill written by hooks. Plugin-side; no `init` rerun.
- The eval case `reflect-reconcile`: a planted older line in a project skill says a one-line query may stay in the controller, and the notes say the opposite. The `reflect` skill proposed rewriting that line in 4 runs of 4 as it is, so a step added to do so was taken out (the same with and without it: 4 of 4 each); the case stays as a guard. Nothing a project installs changed.
- The micro-test case `skill-routing` (`scripts/micro/cases/skill-routing.mjs`), from revfactory/harness's habit of testing a skill's description with requests that should and should not trigger it: 34 requests in one call, scored by the share answered with the right first skill, with the listing read from `skills/*/SKILL.md` (alone, and among 11 skills of other plugins). On Sonnet the descriptions of the six skills the model can start by itself routed every request in 5 runs of 5 (1.00; the control with no skills 0.29; names alone 1.00, and 0.99 among the other plugins' skills), so it is at its ceiling and shows nothing to tune; it stays as a guard for edits to a description. One request at a time in a real session is the next entry; a listing of hundreds of skills is not measured. This repo's tooling; nothing a project installs changed.
- `scripts/micro/routing-live.mjs` (`npm run micro:routing`), the real-session half of `skill-routing`, from skill-creator's trigger evaluation in anthropics/skills: each request alone in a real `claude -p` session in a Stack Agent sample project with the plugin loaded (your own plugins off, load checked), stopped at the first tool call, which decides: the Skill tool is a load, anything else is none. A hook refuses every tool, no session file is kept, a session that ends with no tool call and no successful answer (a timeout, a budget cap, a failed login) is an error and not "no skill", the plugin's skills must be listed in the session, and sessions run in a folder with no `CLAUDE.md` above it (`--work-dir`; one found at `C:\Users\<you>` reached every session started from the Windows temp folder). `--only`, `--arms full+superpowers`, `--total-budget`, `--dry-run`. On Sonnet over 62 measured sessions it found what the text test (100%) hid: 26 of 30 right on 15 requests x 2, and on the three that missed, `verify` for "run the checks and tell me whether the new rule really works" 0 in 7 (every session ran Bash), `api-map` for "which file handles GET /reports/summary?" 4 in 7, `feature-map` for "where is the --top flag handled in this CLI?" 2 in 7. A rerun in a clean work folder (45 sessions, 41 right) kept the `verify` miss (0 of 10 in all) and not the `api-map` one (7 of 10), so only the first is solid. No description was changed; see the design notes (2026-10-29) for what it does and does not show. This repo's tooling; nothing a project installs changed.
- `--requests FILE` for `routing-live.mjs` (your own requests, each naming the skills that are a right first load), and `--work-dir DIR` for `micro/run.mjs`, `micro/tune.mjs`, and `ab/run.mjs`: they start their sessions in a folder with no `CLAUDE.md` above it (the first of the system temp folder, `C:\Users\Public`, `C:\ProgramData`, `/tmp` that qualifies), because Claude Code reads a `CLAUDE.md` from the working folder and every folder above it and on Windows the temp folder is inside the profile. A run prints a NOTE and records `memoryFilesRead` when one still reaches the sessions.
- The micro-test case `skip-excuses` (`scripts/micro/cases/skip-excuses.mjs`): the `verify` skill with and without a table of excuses for skipping a step (from addyosmani/agent-skills), against a scenario where the suite is green and the new rule is behind a login. The skill as shipped scored 17 of 20 and with the table 17 of 20 (0 of 20 with no skill), so the table was not added; the case stays as a guard. `docs/out-of-scope.md` lists the five other repos read and why nothing was taken from them.
- `scripts/skill-scan.mjs --rebaseline KEY[,KEY]` (this repo's tooling): writes a skill's SkillSpector baseline again after its text was edited, since the baseline holds a hash of the text. It does so only when the scan finds the same kinds of finding, in the same files and the same number, as the baseline covers; anything else is refused, and each entry keeps its reason.

### Fixed

- `review-findings.mjs` (the `sample-review` validator) accepted a field made only of zero-width or other format characters as "non-empty text", and printed a control character from a finding's id or a field name to the terminal as itself, where an ESC sequence can clear the screen and a bidirectional override can reorder what is shown. Both reproduced, then fixed after cloudflare/security-audit-skill, whose validator requires a visible character: every text field needs one, an excerpt is counted by what shows, and control characters, line and paragraph separators, bidirectional controls, and tag characters are written as `\u{..}` (the joiners Thai, Persian, and emoji need are left alone) in the messages, the JSON, and the review-log rows. Plugin-side; no `init` rerun.
- `mine-transcripts.mjs` (the `mine-corrections` skill) printed past chat messages as typed, so a key or password pasted in an old chat reached the model and could be written into a file in the repo; the only guard was a line in the skill asking the model not to repeat one. `scripts/lib/redact.mjs` now replaces keys, tokens, passwords (English and Thai cues), private keys, credentials in URLs, card numbers that start like a card and pass the Luhn check, Thai national IDs (with separators or after a word like เลขบัตร), and email addresses with `[REDACTED:...]` before anything is printed and before the text is cut to length, and says how many it hid. A shape it does not know can still get through (an unquoted passphrase with spaces, a password typed after a prompt), and a variable such as `const token = req.headers.authorization` is hidden too. An independent review of the first version found a JWT rule whose time grew with the square of the length (200 KB of base64url took 2 s, 1 MB did not finish), keys after a JSON `\n` that leaked, 19% of millisecond timestamps hidden, a Thai sentence about passwords eaten, and `redis://:pass@host` leaked; all fixed with tests, and a megabyte of 34 kinds of awkward text now goes through in well under a second here (the test runs it in its own process and allows 5 s each). Plugin-side; no `init` rerun. Passwords typed on a command line are hidden too (`mysql -pSecret`, `curl -u user:pw`, `sshpass -p`, `docker login -p`, `--password VALUE`).
- A resumed Claude Code session starts with a copy of the history it continues (4,422 of 6,942 user events on one real project were repeats), which made `mine-transcripts` list one correction as coming from two sessions, the bar for a class. Each event is now counted once, in the file changed earliest that holds it, and a file with nothing new is not another session.
- The `verify` skill's description now also names "run the checks" and "tell me whether it really works". In real sessions the request "run the checks and tell me whether the new rule really works" loaded `verify` in 0 of 10 runs; with the change, 3 of 3. On 10 requests written afterwards it made no difference (27 of 30 right before, 26 of 30 after), so the gain is for that wording and not wider.
- The `verify` skill now also asks for a test in the project's own suite, not only a check in `verify.json` (step 2). Found in an A/B of the new descriptions: `verify` loaded in 6 of 9 `validate` runs instead of none, and every time the agent added a check and no test (test added in 3 of 9 runs against 9 of 9 before). With the sentence, 9 of 9 again, at about 10% more cost.
- The descriptions of `api-map`, `feature-map`, `add-migration`, and `verify` now cover requests in other words: a plain "where is X handled" question goes to the map first, any change to the database to `add-migration`, and "confirm" or "double-check" to `verify`. On 33 new requests (`scripts/micro/cases/skill-routing-extra.json`, run with `routing-live.mjs --requests`) in real sessions, Sonnet loaded the right skill first in 50% to 65% of sessions before and 88% to 100% after, and Haiku in 27% to 39% before and 48% to 75% after; a request that should load no skill never loaded one of ours. Small samples, first tool call only (design notes, 2026-10-29). A second pass (a foreign key or a column type, "make sure", "which file implements X", a wrong total, "exposing something over HTTP") moved a further 35 requests only a little: on the 15 unseen ones Haiku went from 40% to 49% and Sonnet stayed at 87%, which is within chance. The file now holds 68 requests.

## 0.5.3 (2026-10-27)

`verify.mjs` changed, so rerun `init` to refresh `.stack-agent/bin/`. Nothing changes until a project sets the new option.

### Added

- `"against": { "requireNewCoverage": true }` in `verify.json` makes a change to the code with no new or changed check or test fail the against step. By default that case still skips with a note (CI passes, and the Stop hook asks once), so CI was a reminder, not a gate; found in a read of this repo's own CI template. A change that alters no behavior (a refactor, a rename) is waived by a `Stack-Agent-No-New-Test: <reason>` line (at least 15 characters) in a commit message since the base; the reason is shown and stays in the history. It is separate from `against.required`, which keeps its meaning (inconclusive results fail).
- A weekly canary in this repo's CI (`.github/workflows/claude-code-canary.yml`, `scripts/canary.mjs`): it installs the latest Claude Code and checks that the plugin still validates (`plugin validate --strict`, no credentials) and, with an `ANTHROPIC_API_KEY` secret, that a headless session still loads it, records the session, and denies `git commit --no-verify` (about $0.003 per run). Against a copy with a dead PreToolUse hook the static check passed and the live one failed. Nothing a project installs changed.

### Fixed

- Test runs could hand two test files the same port (this repo's tests only; nothing a project installs): the OS gives a port back the moment it is closed, so two files running at once could be given the same one and a server in one answered for the other, which made `a server that never becomes ready` pass verify (`0 !== 1`) on a Linux runner now and then. On Linux, two processes asking at once got a port in common in 4 of 30 rounds. Each port is claimed with an exclusive file create in a folder shared by one test run; the same experiment gave 0 of 90 rounds.
- The A/B task `bug-stale-list` (this repo's tests only; nothing a project installs): its planted cache lasted 50 ms, and on a loaded Windows CI runner a read, a create, and a read took longer, so the bug never showed and `tests/ab-tasks.test.mjs` failed on three of six Windows jobs. The window is 300 ms now.

## 0.5.2 (2026-10-27)

Nothing vendored changed, so projects need no `init` rerun.

### Measured

- Stack Agent beside obra/superpowers 7.0.0, 3 runs per task and arm (two bug reports and an endpoint): every run in both arms correct, guard passing, and verified with fresh evidence. superpowers was never invoked: the agent took `stack-agent:debug` and `stack-agent:add-endpoint` every time. Its bootstrap added about 2,200 tokens of context per request and 9% to the spend. Tasks with no matching Stack Agent skill were not measured. Details: design notes, 2026-10-27.

### Fixed

- A release that changed no vendored tool still asked every project to rerun `init`: the `.stack-agent/bin/VERSION` stamp moves with each release and was compared like a tool, so SessionStart said the tools differed and `init --check` reported `outdated: .stack-agent/bin/VERSION` and exited 1. A stamp that differs on its own is no longer reported; when a tool differs, the stamp is listed with it as before. Found while preparing this release, which would have triggered it in every project.

### Added

- A/B arm `full+superpowers` (`--superpowers DIR`): the plugin beside an installed superpowers, isolated only with exactly those two plugins. Every arm sets `SUPERPOWERS_DISABLE_TELEMETRY=1`.
- A `skill-scan` job in this repo's CI runs NVIDIA SkillSpector 2.12.0 (pinned to its commit, static only, no credentials) over each skill, the agents, `hooks.json`, and the hook scripts. It is not a gate: a new finding shows as a warning. The first scan's 8 findings were all false positives (verify's own `--skip-*` flags, the blocked commands named in the hook that blocks them, an output format, and the comment on the Stop hook's cap); each is in `.github/skillspector/` with its reason. The first run on the Linux runner reported 4 more, also false positives (the words "find" and "review" in two skill descriptions, and paths in the adopter's repo that two skills read at runtime), now baselined too. A planted line sending SSH keys to an outside URL was still reported. `scripts/skill-scan.mjs` holds the target list. Adopters' projects are unchanged. Details: design notes, 2026-10-27.

## 0.5.1 (2026-10-27)

Mostly closing ways around the guard, from two reviews of 0.5.0 (agents reading the code independently, attempts against real git, and the CI steps run on Linux). `verify.mjs`, `guard.mjs`, and `lib/files.mjs` changed, so rerun `init` to refresh `.stack-agent/bin/`.

### Measured

- `feature-map-lookup` (new), 2 runs per arm: 1.00 with the plugin against a mean of 0.25 without; only the plugin arm read the feature map. `verify-before-done` after its skill edit: 1.00 in both arms.
- A/B `init-library` (new), plugin arm: before the setup change below, `init --check` passed in 0 of 2 runs, because a headless session cannot approve edits to the protected guard config and workflow; after it, and the hint to use Edit or Write, in 3 of 3, each with its own guard rules and real checks. Details and caveats: design notes, 2026-10-26 (later).
- A/B `shell-sort` (new), 3 runs per arm: the after-shell guard reported the one-liner's violations in all 3 plugin runs, the first time it was seen catching one in a real session, and each agent moved the sorting to the repository. The bare arm did as well, by running `npm run guard` on its own, so this task shows the hook works, not that it is needed when the guard is a visible script.
- `add-migration-column`'s `up-down-up` is now a regex over the trace (`target: trace`); beside the llm grader it replaced, both passed 2 of 2.
- `npm test`: 514 tests, all passing on Windows (Node 26) and Linux (Node 22, WSL2).

### Fixed

- More ways around the guard, found by trying them against real git (each committed past a failing pre-commit hook while the shell hook let it through): `GIT_CONFIG_PARAMETERS` and `GIT_CONFIG_KEY_<n>` setting `core.hooksPath`, an alias that runs `commit --no-verify` (set with `-c` or `git config`), `export HUSKY=0`, and deleting or replacing a file in `.git/hooks`, from the shell or Edit/Write. The first three are denied; a change to `.git/hooks` asks, in Stack Agent projects only. `.husky/` is committed and reviewed, so it is left alone. The command tokenizer split `key="two words"` into two tokens, as it would not in a shell, which hid the alias form; a word is now any run of plain and quoted pieces.
- Ways around the guard: the shell hook let through `git commit --no-verif` (git takes any unambiguous prefix of a long option), `git --config-env=core.hooksPath=VAR commit`, and `git config core.hooksPath x`. All three are denied now, and the other git gates match abbreviations too (`push --de`, `push --m`, `reset --k`, `clean --f`).
- The after-edit and after-shell hooks, the Stop hook's guard, and `guard.mjs --files` did not apply the config's `ignore` list or the default skipped folders, which CI's full scan does, so a fixture or generated file was blamed locally and passed in CI.
- The after-shell guard (new in 0.5.0): it blamed the first command for a `.md` or `docs/` file left dirty before the session, because the session record left those out; one unreadable changed file made it check nothing for the rest of the session; edit hooks running at the same time lost each other's entries, so a violation could be reported twice; and a command run from the top of a monorepo reached no project. The Stop hook's guard had the same blind spot for `.md` files.
- verify: a command that exits while a process it started still holds its output (`start /b`, `&`) was waited on until that process ended, then reported as timed out; it is now judged on its exit code once the output has been quiet for 1.5 s (10 s at most), and that process is stopped (on Windows, found through its parent id, since Windows has no process groups). Output between 8 and 12 MB passed as if all of it had been matched; the 8 MB limit now holds. A command killed by a signal is reported as `killed by <signal>` and is a real red in `--repeat`, not an inconclusive run. A verify stopped with Ctrl+C or SIGTERM stops the server and the commands it started. `--skip-tests --skip-checks --repeat` is refused instead of running the tests anyway.
- On Windows, a project reached through an 8.3 short name (GitHub's runner keeps its temp folder at `C:UsersRUNNER~1`) was a different place from the one git reports by its long name: a shared rules file inside the repository was refused as outside it, `init` showed workflow paths climbing out of the project, and the after-shell guard named files without their monorepo folder. guard, init, the after-shell guard, and the protected-path checks now compare real paths. Found by the first CI run on GitHub, where 11 Windows tests failed; locally the user folder name was too short to get a short name.
- The sample backend's `npm run guard` and `npm run verify` pointed at `../../scripts/`, which exists only inside this repo, so they failed in every installed copy (the A/B and eval projects included). They run the vendored tools now. Earlier A/B results in which an agent used `npm run guard` may show the bare arm worse than it was.
- The `cli-minlen` A/B test failed on machines that have only `python3`; it now skips like the other Python tests.
- Docs that had drifted: the README (EN/TH) said the guard runs only after edits and that CI does not run verify; the init skill named three of the six files it copies; the verify skill left out `expectHeaders`, `followRedirects`, and `timeoutSec`; the Thai changelog's `--repeat` entry left out the first red output.

### Added

- Documented what the code already accepted: verify's `--config` and `--json`, `test.cwd`, `test.env`, `test.timeoutSec`, `server.readyTimeoutSec`, the HTTP check `timeoutSec`, `type`, and the `evidenceDir` default; the guard's `baseline`, `--files`, `--strict`, `--json`, `--config`, and `pythonRoots`; api-map's `--config`, `--json`, and `verifyConfig`; feature-map's `--map` and `--json`; review-findings' `--stage` and `rows --date`; and the A/B harness's `--disallowed-tools`.
- Eval case `feature-map-lookup` (on the library example) and A/B task `init-library` (Stack Agent set up from scratch through the skill). `evals/scaffold.mjs` takes the example to copy. `run-evals` says how each skill is measured, and why `mine-corrections` is not.
- The after-shell guard appends what it reports to `.stack-agent/evidence/sessions/<id>.reports.log`: a session transcript does not carry a hook's output, so this is the record that a report was made.
- A/B task `shell-sort` (a `sed -i` one-liner that breaks two guard rules). A task's `grade` now also receives the transcript and the arm.
- Tests for behavior that had none: the git gates, config errors in verify, guard, and api-map, the against step's skip reasons, `against.setup` and `against.keep`, HTTP failure modes, the output limit, the feature-map and api-map options, and the A/B harness helpers (464 to 514 tests).

### Changed

- Setup can finish without a human at the keyboard: Edit/Write on a `guard.config.json` or Stack Agent workflow that git has never seen and that still has `EDIT ME` placeholders no longer asks. In the `init-library` A/B runs both agents were stopped there, since a headless session cannot approve. Once the placeholders are gone, or the file is staged or committed, edits ask again. A shell write to it still asks, and the refusal now says to use Edit or Write for a template; the init skill says the same.
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
