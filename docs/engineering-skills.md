# The engineering skills

Stack Agent ships 12 skills of its own (`verify`, `debug`, `reflect`, and so on; see the [README](../README.md)) and 28 more for everyday engineering work: test-first development, code review, pull request bodies, domain modeling, planning with tickets, and more. The 28 began as the skills of [mattpocock/skills](https://github.com/mattpocock/skills) (MIT); they have since been renamed, merged, updated, and mostly rewritten here, and [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) says how far each one has moved. This page says how to start each one, what it needs, and what it changes, so a teammate can use them the day the plugin is installed.

[ภาษาไทย](th/engineering-skills.md)

## Install and start

```bash
claude plugin marketplace add Brown248/Stack_Agent
```

```bash
claude plugin install stack-agent@stack-agent-marketplace
```

Restart Claude Code. A skill starts in one of two ways:

- **By asking.** 9 of the 28 are listed to Claude, which loads one when your request matches it: say "build this test-first" and `tdd` loads.
- **By typing its name.** The other 19 start only when you type `/stack-agent:<name>`, for example `/stack-agent:triage`. Claude never loads them from an ordinary sentence. Five of them change your machine or your repository (see "What changes your machine"), which is why they wait for you.

Type `/stack-agent:which-skill` if you are not sure which one fits; it reads the skills that are installed and tells you which skill or flow suits your situation. The short form (`/tdd`) works too while no other plugin has a skill of the same name; when two do, use the full `/stack-agent:` form.

## Without an issue tracker

Most of the daily work needs none:

| You want to | Say or type |
| --- | --- |
| build a feature or fix a bug test-first | "build it test-first" (`tdd`) |
| review the changes since a commit, branch, or tag | "review the diff since main" (`code-review`) |
| write a pull request body | "write the PR description" (`pr`) |
| settle names and record decisions | "let's fix the terms in a glossary" (`domain-modeling`) |
| design a deeper module interface | "where should the seam go?" (`codebase-design`) |
| try an idea in throwaway code | "prototype three layouts" (`prototype`) |
| look something up with sources | "research how X handles Y" (`research`) |
| have your plan stress-tested | "grill me on this plan" (`grilling`) |
| write or fix a skill, `CLAUDE.md`, or `AGENTS.md` | "help me write this SKILL.md" (`writing-for-agents`) |
| any bug, including hard or slow ones | "find and fix this bug" (`debug`) |
| pass the work to another agent | `/stack-agent:handoff` |

## With an issue tracker (GitHub, GitLab, or a local folder)

Run `/stack-agent:setup-workflow` once in the repository. It asks which tracker you use, the labels to use for triage, and where the glossary and decisions live, and writes that down in `.stack-agent/workflow/` (it does not touch `CLAUDE.md` or `AGENTS.md`). The local choice keeps tickets as Markdown files under `.scratch/` in the repository and needs no account. After that:

1. `/stack-agent:grilling` sharpens the plan; in a repository with a `GLOSSARY.md` or `docs/adr/` it also writes the glossary and decisions as you go.
2. `/stack-agent:to-spec` turns the conversation into a spec; `/stack-agent:to-tickets` splits it into thin tickets that name what blocks what.
3. `/stack-agent:implement` builds one ticket, or `/stack-agent:implement-spec` builds the whole spec on one feature branch with a subagent per ticket.
4. `/stack-agent:triage` moves incoming issues and outside pull requests through its states; `/stack-agent:wayfinder` plans work too big for one session.

## The 28 skills

"Typed" means you start it with `/stack-agent:<name>`. "Asked" means Claude can load it from your request.

| Skill | Starts | What it does | Needs |
| --- | --- | --- | --- |
| `tdd` | asked | red-green-refactor, one slice at a time, tests at agreed seams | `GLOSSARY.md` if the repo has one |
| `code-review` | asked | review since a fixed point on two axes, Standards and Spec; only reports | git; a tracker for the spec, or a spec file |
| `codebase-design` | asked | vocabulary for deep modules, seams, interfaces | none |
| `domain-modeling` | asked | build the glossary and ADRs while you talk | writes `GLOSSARY.md`, `docs/adr/` |
| `pr` | asked | pull request body: a visual summary, before/after evidence, a merge-danger call | none |
| `prototype` | asked | throwaway code to answer a design question | the project's own runner for the UI kind |
| `research` | asked | sourced findings saved as Markdown, run in the background | web access |
| `grilling` | asked | relentless questions about a plan; keeps the glossary and decisions when the repo has them | writes the docs only then |
| `writing-for-agents` | asked | how to write skills, `CLAUDE.md`, `AGENTS.md` | none |
| `which-skill` | typed | which skill or flow fits | none |
| `handoff` | typed | compact the conversation for another agent | none |
| `retro` | typed | suggest improvements to the agent's environment after a session | old session logs |
| `teach` | typed | teach you a concept in a scratch folder | writes notes in the working folder |
| `to-questionnaire` | typed | turn an open decision into questions for someone else | none |
| `re-explain` | typed | "that did not land": say the last message again in short plain sentences | none |
| `improve-codebase-architecture` | typed | find deepening opportunities, show an HTML report | a browser; a connection for the report's scripts |
| `setup-workflow` | typed | one-time tracker, labels, and docs setup, written to `.stack-agent/workflow/` | git; `gh` or `glab` unless local |
| `to-spec` | typed | publish a spec to the tracker | tracker |
| `to-tickets` | typed | thin tickets with blocking edges | tracker, or a local file |
| `triage` | typed | issues and outside pull requests through a state machine | tracker |
| `wayfinder` | typed | a map of decision tickets for very large work | tracker |
| `implement` | typed | build a spec or tickets with `tdd`, then verify and review | tracker |
| `implement-spec` | typed | a whole spec on one feature branch, subagents per ticket | tracker, git worktrees |
| `git-guardrails` | typed | install a hook that blocks `git push`, `reset --hard`, `clean`, `branch -D` | Node 22 |
| `setup-pre-commit` | typed | Husky, lint-staged with Prettier, typecheck and tests on commit | npm, pnpm, yarn, or bun |
| `step-script` | typed | a bash script that walks a person through steps only they can do | bash (Git Bash or WSL on Windows), `gh`, `.env` |
| `scaffold-exercises` | typed | exercise folders for a course layout | a repo laid out for that course tooling |
| `migrate-to-shoehorn` | typed | replace `as` in tests with `@total-typescript/shoehorn` | npm, TypeScript |

## What changes your machine or your repository

These start only when you type them, and each does something you should know about first:

- `git-guardrails` can write `~/.claude/settings.json` and `~/.claude/hooks/` (it asks project or all projects). It blocks every plain `git push`, which Stack Agent allows. The hook is a small Node script, so it needs no `jq` and works for the Bash and PowerShell tools. Stack Agent's own hooks already ask before a force-push, `reset --hard`, `clean`, and a branch deletion.
- `setup-pre-commit` installs packages, runs `npx husky init` (which sets `core.hooksPath`), and adds Prettier through lint-staged. In a Stack Agent project keep `.stack-agent/` out of Prettier.
- `step-script` reads `.env` and can write secrets into it and into GitHub. The script it generates refuses to write a file that git would not ignore, and aims every `gh secret set` and `gh variable set` at one named repository (`WIZARD_REPO`, or the one `gh` finds) and prints it.
- `scaffold-exercises` and `migrate-to-shoehorn` install and run packages.
- `improve-codebase-architecture` writes an HTML report and opens it in a browser. The page loads scripts from a public CDN, so it needs a connection and fetches code from outside while it is open; the skill also has an offline form without scripts. Keep the file local and do not publish it.
- `setup-workflow` writes three files in `.stack-agent/workflow/` and, only after you say yes, can create the triage labels on your tracker.
- `triage`, `implement`, `implement-spec`, `to-spec`, `to-tickets`, `wayfinder` write to your tracker. They never push or open a pull request unless you ask. Text from issues and pull requests is treated as data; `triage` changes nothing before you confirm and shows you a command before it runs something taken from a report.

## Next to Stack Agent's own skills

| If you type | Starts | Note |
| --- | --- | --- |
| a bug report, "find and fix it", "why does this return 500" | `debug` | Stack Agent's: a repro first, kept as a test, fixed at the cause, with `verify` evidence. For hard or slow bugs it points to its own `LOOPS.md`, the catalogue of ways to build the repro. |
| "make sure it works" | `verify` | `tdd`, `implement`, and `implement-spec` run `verify` too in a project that has `.stack-agent/verify.json`. |
| "spot-check recent commits" | `sample-review` (typed) | `code-review` reviews a diff you name; `sample-review` samples commits to find patterns for the guard. |
| "what do I keep correcting" | `mine-corrections` (typed) | `retro` and `writing-for-agents` suggest changes to the agent's environment and instructions. |

In a project that uses Stack Agent, the Stop hook asks for evidence that matches the code when it changes. `prototype` code is thrown away, so keep it on its branch or say it is unverified.

## If you already use mattpocock/skills

Do not keep both. If you installed that plugin or ran its installer, remove it (or Stack Agent's copy) so the same idea is not listed twice. Several names differ here (`ask-matt` is `which-skill`, `setup-matt-pocock-skills` is `setup-workflow`, `wait-what` is `re-explain`, `wizard` is `step-script`, `git-guardrails-claude-code` is `git-guardrails`; `grill-me` and `grill-with-docs` are `grilling`; `diagnosing-bugs` is part of `debug`), and the tracker settings live in `.stack-agent/workflow/` instead of `docs/agents/`.

## Where these came from and how they change

The skills are ours to edit. [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) keeps the MIT license of the upstream project and lists, for each skill, whether it is *rewritten* (new text with upstream's idea) or *edited* (upstream's text with changes), and every change beyond wording. A newer upstream release is read for ideas and carried over by hand; it cannot be copied over. After any change to a skill run `claude plugin validate . --strict`, `npm test`, and `node scripts/skill-scan.mjs`, and rerun its eval case (see the `run-evals` skill).
