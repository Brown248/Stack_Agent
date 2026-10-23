# Out of scope

Ideas Stack Agent decided not to adopt, and why. `design-notes.md` says why each piece exists; this page says why some pieces do not, so the same request does not have to be argued again. If you fork Stack Agent and your team wants one of these, nothing stops you: the reasons below are about a template for any project, not about your project.

Ideas from the original talks that were left out (auto-merge, browser control, cloud agents, rules from one codebase) are under "Left out on purpose" in [design-notes.md](design-notes.md); this page holds the ones from other projects. Each entry gives the idea, where it came from, the reason, and what Stack Agent does instead. To reopen one, show what changed: a measured failure the current design misses, or a reason below that no longer holds.

[ภาษาไทย](th/out-of-scope.md)

## A bootstrap prompt injected into every session

- **Source:** obra/superpowers, `skills/using-superpowers` loaded by its SessionStart hook ("If you think there is even a 1% chance a skill might apply… you ABSOLUTELY MUST invoke").
- **Why not:** it enforces with prose and costs tokens in every session, including ones where no skill applies; superpowers itself had to trim it (release notes v6.1.0). Stack Agent's rules have to hold when the agent ignores the prose.
- **Instead:** hooks and scripts that stop the agent (the Stop hook, the shell and edit hooks, verify, guard), active only in a Stack Agent project; skill descriptions that name when to start, measured by A/B runs and eval cases.

## One development methodology for every project

- **Source:** obra/superpowers (brainstorm, plan, worktree, subagent execution, strict TDD that deletes code written before its test, finishing a branch by merge or PR).
- **Why not:** a template for any project cannot pick one way of working; teams differ on TDD, branching, and review. A fixed merge flow also clashes with letting the person decide when to commit.
- **Instead:** checks that hold whatever the method: verify with its against step proves a check fails on the old code, the guard ratchets rules, and the Stop hook asks for a test or check when code changed without one.

## Manifests and shims for other agent harnesses

- **Source:** obra/superpowers (about 16 harnesses), mattpocock/skills (`agents/openai.yaml`, skills.sh).
- **Why not:** most of what Stack Agent enforces lives in Claude Code hooks. A port without hook equivalents would ship the skills without their enforcement and look like it works.
- **Instead:** the vendored scripts in `.stack-agent/bin/` and the CI workflow are plain Node and run anywhere; the hooks and skills are Claude Code only.

## Skills built on an issue tracker

- **Source:** mattpocock/skills (`triage`, `to-tickets`, `to-spec`, `wayfinder`, `implement-spec`, `setup-matt-pocock-skills`), which read and write issues through `gh` or `glab` and a per-repo tracker doc.
- **Why not:** Stack Agent assumes no tracker, host, or CLI beyond git and Node.
- **Instead:** a spec comes from the commit message or a file (`sample-review`, the reviewer's `spec` source).

## Tools that need `npm install`

- **Source:** Changesets (mattpocock/skills releases), dependency-cruiser (`setup-ts-deep-modules`), the Quorum eval harness (obra/superpowers: bun, tmux, containers).
- **Why not:** target repos vendor the scripts into `.stack-agent/bin/`, and CI runs them with no install step. One dependency breaks that for every project. Changesets also writes an English-only changelog, and Stack Agent keeps two.
- **Instead:** zero-dependency Node ESM scripts, guard import rules with `extends` for module boundaries, the A/B harness in `scripts/ab/`, and `claude plugin eval` for the eval cases.

## Fixing the legacy violation in the sample backend

- **Source:** anyone reading `examples/sample-backend/src/modules/reports/controller.js`.
- **Why not:** the `module-boundary` violation there is the baseline the ratchet demo and its tests rely on.
- **Instead:** it stays in `.stack-agent/guard-baseline.json`, and new violations still fail.
