---
name: run-evals
description: Use to test whether a skill change actually improves agent behavior, with the plugin's eval suite (claude plugin eval), with and without the plugin. Use for /run-evals, "ทดสอบ skill", "run the evals", or before trusting an edited skill.
disable-model-invocation: true
---

# Run the evals

Evals are unit tests for skills. Each case in `evals/<case>/` gives an organic task to a fresh agent in an empty temporary directory, then graders score the result. `claude plugin eval` runs every case with the plugin and without it, so the delta (Δ) shows whether the plugin helps.

## Requirements

- Claude Code v2.1.269 or later.
- These cases let the agent use Bash, and native Windows has no sandbox, so run them from WSL2 or Linux/macOS.
- The cases use `--scaffold` to copy the sample backend into the run directory.

## Run

From the Stack Agent repo root:

```bash
claude plugin eval . --scaffold --allow-tools Bash Write Edit --no-publish --runs 1
```

Then the full run (3 runs per case) before trusting a change:

```bash
claude plugin eval . --scaffold --allow-tools Bash Write Edit --no-publish --json evals/results/last-run.json
```

- `--scaffold` runs each case's `scaffold.sh`, which copies `examples/sample-backend` into the run directory and installs the tools.
- `--allow-tools Bash Write Edit` grants the gated tools the coding cases need. The read-only cases (`api-map-lookup`, `feature-map-lookup`, `reflect-lessons`, `reflect-reconcile`) need none.
- `--no-publish` keeps the HTML report local instead of publishing it to claude.ai.
- `--case "add-endpoint*"` runs one case. `--max-cost-usd <n>` is a spending cap. `--trust-plugin` skips the trust prompt in CI.
- LLM graders use haiku by default, a different model from the one doing the work. `--judge-model <id>` changes it.

The exit code is 0 only when every case reaches the threshold (default 1.0).

## What the cases cover

| Skill | Case |
| --- | --- |
| `verify` | `verify-before-done` |
| `add-endpoint` | `add-endpoint-delete-item` |
| `add-migration` | `add-migration-column` |
| `api-map` | `api-map-lookup` |
| `feature-map` | `feature-map-lookup` (the library example, so the map is a feature map, not an API map) |
| `debug` | `debug-blank-name` (a plain bug report; `used-debug-skill` shows whether the skill was picked up on its own) |
| `correct` | `correct-error-body` (started by name; the planted history shows the mistake twice) |
| `reflect` | `reflect-lessons` (started by name; the corrections are quoted in the prompt) and `reflect-reconcile` (a planted line in a project skill that the new correction contradicts) |

`sample-review` has no case: it reviews each commit in a temporary checkout, and the eval sandbox cannot write any file, so the checkout cannot be made. Measure it with the A/B task `review-spec` (`scripts/ab/run.mjs`), which runs real sessions.

`stack-agent-init` has no case for the same reason (it runs `init.mjs` from the shell). The A/B task `init-library` starts a real session from a library with Stack Agent taken out and grades the result with `init --check`, verify, and the guard; run its plugin arm only. `mine-corrections` has neither: it reads past Claude Code sessions from your home folder, which neither harness gives a run, so check it by hand on a repository you have worked in.

## Read the result

- A case that passes with the plugin but also passes without it (Δ ≈ 0) means the skill is not what made it pass. The skill may be unnecessary, or the case is too easy.
- A case that fails with the plugin: read `evals/results/<timestamp>/report.html` and the run's trace. Find the step the agent skipped or misread, fix that skill, and rerun only that case.
- One run per arm gives a direction, not a score. On 2026-10-24, two cases whose files had not changed moved by a quarter and a third between back-to-back runs, each from one llm grader flipping. Before calling an edit a win or a loss, look at the graders the edit targets; if the only difference is one other grader, rerun that case with `--runs 3`.
- Graders that score by script (`regex`, `tool_used`, `file_exists`) are facts. `llm` graders are judgment, so read the trace yourself when one disagrees with what you see.

## Hill-climb

One skill edit, one rerun, keep or revert. Do not stack untested edits. Stop when every case passes and Δ is positive, or report the case that still fails and why.
