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

- **Source:** Changesets (mattpocock/skills releases), dependency-cruiser (`setup-ts-deep-modules`), the Quorum eval harness (obra/superpowers: bun, tmux, containers), Playwright (microsoft/playwright).
- **Why not:** target repos vendor the scripts into `.stack-agent/bin/`, and CI runs them with no install step. One dependency breaks that for every project. Changesets also writes an English-only changelog, and Stack Agent keeps two.
- **Instead:** zero-dependency Node ESM scripts, guard import rules with `extends` for module boundaries, the A/B harness in `scripts/ab/`, and `claude plugin eval` for the eval cases. A project that already uses Playwright can run it as a command check in its own `verify.json`.

## Skills written, changed, and archived by the tool itself

- **Source:** tigerless-labs/autoharness (MIT): every 50 tool calls a background haiku session reads the work and proposes skills, a script validates and writes them, and skills nobody loads are moved to an archive folder.
- **Why not:** a skill is read by every future session, so one written without a person is a change nobody reviewed; Stack Agent shows a table with the quoted evidence and waits (`reflect`, `mine-corrections`). The loop also pays for a child session per cycle, and its own README calls the thresholds "placeholders pending empirical calibration": nothing there shows it helps, and a change that no one measured is the kind this repo's measurements have often turned down. It needs Python 3.11 and lists Linux and macOS only; Stack Agent runs on Windows with Node alone.
- **Instead:** the parts that stand alone were taken: the secret filter that now runs before a mined session reaches the model, and a count of which skills were used (`scripts/skill-usage.mjs`), which reads the transcripts that already exist instead of a hook and a counter file, and only reports. Its rule to rewrite an older line that a new one contradicts was tried and not taken: `reflect` already did it in 4 runs of 4 (design notes, 2026-10-29).

## A skill that designs a team of agents for a domain

- **Source:** revfactory/harness (Apache 2.0): "build a harness for this project" generates agent definitions, skills, and an orchestrator in six team patterns, with a skill to evolve them.
- **Why not:** Stack Agent gives the same fixed rules, checks, and skills to every project, and the point of a template is that the checks hold whatever the agents are. A generated team is new, unreviewed instructions per project, and its published gain is the author's own measurement on 15 tasks.
- **Instead:** presets with a `.stack-agent/` of rules the project edits, three read-only agents (`reviewer`, `judge`, `finding-verifier`), and `reflect` / `mine-corrections` to change a skill with a person's approval. Its test for a skill's description was taken (`skill-routing`).

## A swarm, memory, and federation platform

- **Source:** ruvnet/ruflo (MIT): 98 agents, 314 MCP tools, swarms, a vector memory, agents on different machines, and 35 plugins.
- **Why not:** it is a different product. Its instruction file alone is 72 KB in every session, and the one verification report read passes by checking that a string is still in a file. Stack Agent keeps the hard rules in hooks and scripts that stop the agent, and adds no memory that a person cannot read.
- **Instead:** nothing taken. The PreToolUse hooks already ask before a destructive git command or a change to the guard's own rules; Stack Agent has nothing about spending.

## A table of excuses in every skill

- **Source:** addyosmani/agent-skills (MIT): each skill ends with the excuses an agent gives for skipping a step and a rebuttal for each.
- **Why not:** tried, and it did not help. With the `verify` skill and a reason that looks good for not writing a check, Sonnet did the right thing 17 times in 20 with the skill as shipped and 17 in 20 with a five-row table added (0 in 20 with no skill); none of the misses used the excuse (design notes, "Seven more repos read"). It is one scenario and one model.
- **Instead:** the skills as they are, and the case `skip-excuses` to notice if that changes. Its lifecycle commands (`/spec`, `/plan`, `/build`) fall under "One development methodology for every project" above.

## A code knowledge graph the agent is pushed to query

- **Source:** Graphify-Labs/graphify (Apache-2.0 / MIT): tree-sitter builds a graph of calls and imports, with a `/graphify` skill and a hook that nudges search-style tool calls toward it.
- **Why not:** it overlaps `api-map` and `feature-map`, needs Python 3.10 and `uv` or `pipx`, and steering the agent away from reading the code is the opposite of what verify asks for. Its measured gains are the author's own, on one repository.
- **Instead:** `api-map` and `feature-map`, which fail when the map drifts from the code. One idea could be borrowed if drafted maps cause trouble: mark each line as stated in the source or guessed.

## Skills whose result is taste, and products that are not about checking

- **Source:** blader/humanizer (rewrites text so it reads as human; MIT), nextlevelbuilder/ui-ux-pro-max-skill (a searchable catalog of styles and palettes; MIT, with a paid tier), infiniflow/ragflow (a RAG engine with services and databases), ComposioHQ/awesome-claude-skills (a list of skills).
- **Why not:** no command can say that a rewrite sounds human or a layout looks good, so verify, guard, and the hooks have nothing to hold on to; the claims they make come from a single blind test or from the authors' own demos. RAGFlow is a different product, and a list holds nothing to adopt.
- **Instead:** nothing taken. Stack Agent's `frontend-web` preset checks that the page loads and the e2e command passes, and says so rather than judging looks.

## Fixing the legacy violation in the sample backend

- **Source:** anyone reading `examples/sample-backend/src/modules/reports/controller.js`.
- **Why not:** the `module-boundary` violation there is the baseline the ratchet demo and its tests rely on.
- **Instead:** it stays in `.stack-agent/guard-baseline.json`, and new violations still fail.
