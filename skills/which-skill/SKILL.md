---
name: which-skill
description: Ask which skill or flow fits the situation you are in. A router over the skills in this plugin. It only suggests.
disable-model-invocation: true
argument-hint: [your situation, optional]
---

# Which skill fits

Nobody remembers 40 skills. This skill maps a situation to the skill or the flow that fits. It suggests and stops. It never starts another skill: a typed-only skill cannot be started by the model, so the answer names the command and the user types it.

## 1. Answer from what exists

The tables below were built from each skill's front matter and can go stale. Before answering, list what is really installed, and before describing what a skill does, read its `SKILL.md`. Do not describe a skill from memory.

```bash
ls skills
grep -H -E '^(name|description|disable-model-invocation):' skills/*/SKILL.md
```

```powershell
Get-ChildItem skills -Directory | Select-Object Name
Select-String -Path skills/*/SKILL.md -Pattern '^(name|description|disable-model-invocation):'
```

In a project that uses the plugin, run the same commands in the plugin's `skills/` folder. A skill with `disable-model-invocation: true` is missing from Claude's own skill list; the tables here are how the user finds it.

If the user gave a situation, answer with one skill or one flow (section 3), the exact command, and one sentence on why it fits. If they gave nothing, ask what they are trying to do, then answer. Do not print all the tables unasked.

"Claude" in the tables means Claude starts it from a plain request (typing the command also works). "Typed" means the user types `/stack-agent:<name>`.

## 2. The map

### An idea, not yet a plan

| Situation | Skill | Starts |
| --- | --- | --- |
| Pressure-test a plan or design by questions | `grilling` | Claude |
| A design question that only running code can answer | `prototype` | Claude |
| Look something up in official sources while work goes on | `research` | Claude |
| The answer sits in someone else's head | `to-questionnaire` | Typed |
| Two names for one thing, or a hard-to-undo decision to record | `domain-modeling` | Claude |
| Where a module's interface and seam should go | `codebase-design` | Claude |
| An effort too big for one session | `wayfinder` | Typed |

### Planning with a tracker

| Situation | Skill | Starts |
| --- | --- | --- |
| Turn a discussion into a spec on the tracker | `to-spec` | Typed |
| Split a spec into thin tickets with blocking links | `to-tickets` | Typed |
| Sort incoming issues and outside pull requests | `triage` | Typed |

### Building

| Situation | Skill | Starts |
| --- | --- | --- |
| Build one ticket test-first and send it to review | `implement` | Typed |
| Build a whole spec on one integration branch | `implement-spec` | Typed |
| Test-first work without a spec | `tdd` | Claude |
| A new HTTP endpoint (backend-http preset) | `add-endpoint` | Claude |
| Any database change | `add-migration` | Claude |
| Which file handles an endpoint (API map) | `api-map` | Claude |
| Where a user-facing feature lives in the code | `feature-map` | Claude |
| Replace `as` assertions in tests with shoehorn | `migrate-to-shoehorn` | Typed |

### Finishing and reviewing a change

| Situation | Skill | Starts |
| --- | --- | --- |
| Prove a change works before calling it done | `verify` | Claude |
| Review a branch or PR against the spec and standards | `code-review` | Claude |
| Write the pull request body | `pr` | Claude |
| Spot-check a random sample of recent commits | `sample-review` | Typed |

### A bug

| Situation | Skill | Starts |
| --- | --- | --- |
| Anything broken, wrong, slow, or flaky | `debug` | Claude |
| Where does this endpoint or feature live, before debugging | `api-map`, `feature-map` | Claude |

### Keeping the agent's environment healthy

| Situation | Skill | Starts |
| --- | --- | --- |
| Look back over a session and fix the environment | `retro` | Typed |
| This session went wrong; make the lesson permanent | `reflect` | Typed |
| The same mistake keeps coming back; make it impossible | `correct` | Typed |
| Find repeated corrections in past sessions | `mine-corrections` | Typed |
| Check that an edited skill still helps | `run-evals` | Typed |
| Find modules worth deepening | `improve-codebase-architecture` | Typed |
| Write or fix a skill, `CLAUDE.md`, or `AGENTS.md` | `writing-for-agents` | Claude |

### In the middle of a conversation

| Situation | Skill | Starts |
| --- | --- | --- |
| The last message did not land; say it again, simply | `re-explain` | Typed |
| Move the work to a fresh session | `handoff` | Typed |
| Learn a concept over several sessions | `teach` | Typed |

### One-off setup

| Situation | Skill | Starts |
| --- | --- | --- |
| Set up Stack Agent in a repo | `stack-agent-init` | Typed |
| Set up the issue tracker, triage labels, domain docs | `setup-workflow` | Typed |
| Block dangerous git commands with a hook | `git-guardrails` | Typed |
| Pre-commit hooks with Husky and lint-staged | `setup-pre-commit` | Typed |
| A procedure only a human can do (credentials, dashboards) | `step-script` | Typed |
| Exercise folders for a course-style repo | `scaffold-exercises` | Typed |

## 3. Typical flows

- **Idea to shipped change:** `grilling`, then `/stack-agent:to-spec`, `/stack-agent:to-tickets`, then `/stack-agent:implement` per ticket or `/stack-agent:implement-spec` for all of them, then `code-review`, then `pr`. A small change skips the spec and tickets: `grilling` if it is unclear, then `/stack-agent:implement` on a described task or `tdd`.
- **An idea that needs running code first:** `grilling`, `prototype`, carry the answer back, then continue as above. The prototype and the main work can live in different folders; `/stack-agent:handoff` carries the answer between sessions.
- **Bug:** `debug`. After the fix, `/stack-agent:retro` asks what would have prevented it. If the finding is that nothing could lock the bug down, that is a job for `/stack-agent:improve-codebase-architecture`.
- **A large, foggy effort:** `/stack-agent:wayfinder` charts a map of decision tickets and resolves them one at a time. It plans and does not build. When the map clears, go to `/stack-agent:to-spec`, not straight to implementation, unless the effort turned out small.
- **Incoming issues:** `/stack-agent:triage` is only for issues the user did not write. Tickets from `to-tickets` are already ready: do not triage them.
- **A new repo:** `/stack-agent:stack-agent-init`, then `/stack-agent:setup-workflow` if the team plans with a tracker.

The tracker family (`to-spec`, `to-tickets`, `triage`, `wayfinder`, `implement`, `implement-spec`, and in part `code-review`, `pr`, `prototype`) reads `.stack-agent/workflow/`. Run `/stack-agent:setup-workflow` once first; it writes `tracker.md`, `triage-labels.md` and `domain.md` there. Without it these skills stop and say so.

## 4. When nothing fits

Say so plainly: "none of these skills fits that". Then do one of two things. Offer to do the task directly without a skill, or, if it is a job that will recur, suggest `writing-for-agents` to write a new skill. Do not stretch a nearby skill over a request it was not made for, and do not invent a skill name that `ls skills` does not show.

## 5. Where to cut the context

For the choice between carrying on, `/compact`, `/clear`, a handoff note, or a subagent at the end of a phase, read [PHASE-BOUNDARIES.md](PHASE-BOUNDARIES.md). One rule here: keep grilling, the spec, and the tickets in a single conversation, so all three build on the same reasoning. Start each `/stack-agent:implement` fresh from its ticket. Run `/stack-agent:retro` in the session it looks back on, before clearing.

## Done when

- The answer names one skill or one flow, with the exact command, taken from the skills that exist now.
- A typed-only skill is shown as a command for the user to type, never as something started here.
- If nothing fit, that was said in plain words.

## Report

Give the command first, then one sentence on why it fits, then any skill that must come before it (usually `/stack-agent:setup-workflow`). Say so if a skill named in the map is missing from `ls skills`.
