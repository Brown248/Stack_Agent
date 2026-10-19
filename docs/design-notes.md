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
| Verification: the agent proves the change works on the real program | `scripts/verify.mjs` (tests, server, HTTP checks, command checks, evidence), skill `verify` | `tests/verify.test.mjs`, `tests/verify-command.test.mjs`, both examples pass full verify |
| Close the loop: check results in the same session | evidence in `.stack-agent/evidence/latest.json` (records full vs partial runs), Stop hook `stop-verify.mjs` | `tests/hooks.test.mjs`, `tests/stop-hook.test.mjs` |
| Feature map: where each feature lives | `scripts/api-map.mjs` for HTTP backends, with drift detection | `tests/api-map.test.mjs`, real eval run (below) |
| Hard constraints in lint/CI, not prompts | `scripts/guard.mjs` + `templates/ci/stack-agent.yml` | `tests/guard.test.mjs`, `tests/presets.test.mjs` |
| Shortest path = correct path | every rule must carry a `fix`, and the PostToolUse hook hands it to the agent right after the edit | guard config tests, hook tests |
| Turn repeated review comments into rules | skill `correct` (architecture, then types, then guard, then tests, docs last) | skill instructions |
| Ratchet for shared repos | baseline counts, `--allow-increase`, `--compare-ref` | ratchet and compare-ref tests |
| Sampling review instead of reviewing every PR | `scripts/sample-commits.mjs` + skill `sample-review` + agent `reviewer` | `tests/sample-commits.test.mjs` |
| Evals as unit tests for skills, blind, judged by another model | `evals/` in `claude plugin eval` format (with/without delta, haiku judge by default), agent `judge`, skill `run-evals` | one case run for real (below) |
| Deterministic work in scripts, judgment to the agent | zero-dependency scripts for every repeatable step | 122 tests |
| Skills: small, composable, with scripts, getting better each use | 9 skills, `reflect` for improving them | `claude plugin validate --strict` |
| Who may invoke a skill | `disable-model-invocation: true` on skills that write many files or cost money | skill frontmatter |
| A live layer between prompt and CI | `hooks/hooks.json`: PreToolUse (shell and edits to guard files), PostToolUse, Stop | `tests/hooks.test.mjs` |

## Left out on purpose

- **Auto-merge and an outer loop** (pulling work from Slack or trackers): add these only after verification and the guard have a track record in your repo.
- **Browser control (Control Glass):** use your own e2e runner as a command check (`frontend-web` preset). A built-in browser driver would add a heavy dependency.
- **Cloud agents (Benny):** depends on Cursor Automations, which Claude Code does not have.
- **Project-specific rules from the talks** (no `useEffect`, no code comments): those belong to one codebase. Write them as `pattern` rules if you want them.

## Known limits

- Import-based rules read JS/TS only. Other languages use `pattern` rules.
- The shell hooks match patterns, so a determined workaround (an alias, or a script that writes a file without naming it) can slip past. CI with `--compare-ref` and CODEOWNERS is the gate that always holds.
- The PostToolUse guard covers Edit/Write. Shell edits are caught by CI and the Stop hook.
- The ratchet counts per file per rule.
- An LLM judge in Claude Code can only be another Claude model, so "a different model" means a different Claude model.

## Verification status

| What | Status |
| --- | --- |
| Unit and integration tests | 122 pass on Windows 11, Node 25 |
| Both examples (Node API, Python CLI) | pass guard and full verify |
| Mutation check (14 deliberate bugs) | all caught by the tests |
| `claude plugin validate --strict` | passes |
| Eval `api-map-lookup` (read-only) | run twice for real: 1.0 with the plugin, 0.5 without, delta +0.5. Both answered correctly. The difference is that with the plugin the agent read the map first. |
| Evals that use Bash (`add-endpoint-delete-item`, `verify-before-done`, `add-migration-column`) | load correctly, not yet run: they need Linux, macOS, or WSL2 |
| CI on Linux and Windows, Node 22/24 | configured, not yet run |
| Hooks inside a live Claude Code session | verified in real headless runs (`claude -p --plugin-dir`, Claude Code 2.1.300, haiku, $0.05 total): the `--no-verify` deny, the guard-baseline ask, the PostToolUse guard, and the Stop reminder all fired, and the reminder stayed silent the second time |
| Guard full-scan speed | after caching glob regexes and dropping redundant file checks: synthetic repos without imports, 1k/5k/20k files, 1,535→180 ms, 2,872→639 ms, 16,698→2,239 ms; import-heavy repos (`scripts/bench-guard.mjs`) 13–17% faster. Then each import target is resolved on disk once per run instead of once per import: import-heavy 1k/5k files, median 566→254 ms and 2,859→1,312 ms (about 2.2x; a noisy machine, best runs 511→213 and 1,775→860 ms). Output is byte-identical before and after each step. A later independent rerun on a busy machine was too noisy to confirm the exact ratio (3 of 4 comparisons faster, 1.7–3x; one slower), so treat it as indicative. Output hashes were identical in every run. |

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
