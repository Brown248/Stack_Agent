---
name: retro
description: Hold a retrospective on a coding session and propose changes to the agent's environment.
argument-hint: "[which session]"
disable-model-invocation: true
---

# Retrospective on a session

The user wants a retrospective. The aim is to improve the agent's **environment** (files, checks, tools, instructions) so the next run goes better. It is not a review of the code or a list of blame.

## 1. Load the writing guide

Call the Skill tool with `writing-for-agents` for the style of any instruction file you propose.

## 2. Read the primary sources

Read what happened in the session the user names. If none is named, use the current conversation.

- For the current conversation, use the messages already in context.
- For past sessions, Claude Code keeps transcripts under `~/.claude/projects/`. Do not grep them by hand. To find what the user keeps correcting across sessions, ask the user to type `/stack-agent:mine-corrections`: it reads the transcripts with a script that redacts secrets. This skill cannot start it, because it is typed-only.
- Never print raw transcript text. If you must quote a line, quote it after redaction, and write `<REDACTED>` for any key, token, password, or personal data.

## 3. Look for candidates

Check each category. Every candidate needs evidence from the session: a quote, a file path, or a command that was slow or wrong.

- **Navigation.** Did the agent take long to find the right files? Are there hidden dependencies between files? A **navigation pointer** (one line saying where to look) may fix it. Use when the session spent a long time finding one piece of information.
- **Automated checks.** Could a linter, type check, test, or filesystem check have caught the agent's mistake? Read the repo's own check command first (the `lint` and `check` scripts in `package.json` or the build tool, and the CI workflow). A check that exists but is not wired in, or fails silently, is the finding; do not reinvent it. A repo with no **guardrail** (no pre-commit hook and no CI job that runs lint, typecheck, and tests) is a finding in itself. Use when a check could have caught the mistake, or the repo has no guardrail.
- **Coding standards.** Should the reviewer agent get a new rule, or should an existing rule be removed or made clearer? First classify the violation. A **mechanical** one (a fixed syntax pattern, a banned API, an import shape, a file-location rule) gets a deterministic check: a custom linter rule, a pre-commit hook, or a CI job, whichever is cheapest in this repo. Build the check instead of writing the rule. Keep `CODING_STANDARDS.md` for **judgement calls** (consistency across files, "match the surrounding style"), which no check can replace. Use when the reviewer missed a mistake.
- **Instruction files.** Is a steering instruction in `CLAUDE.md` (project or `~/.claude/CLAUDE.md`) better placed in the coding standards or in an automated check? Use when the file is large. Claude Code reads `AGENTS.md` only when the project has no `CLAUDE.md`. To share one file between tools, put `@AGENTS.md` on the first line of `CLAUDE.md` and keep the rules in `AGENTS.md`.
- **Tool economy.** Did the agent make expensive tool calls that could be shorter? Is any custom tooling (CLIs, MCP servers) wasteful in output size? Use when a call was expensive.
- **No-ops.** Find instructions in steering files that do not change the agent's behavior; propose removing them. Use when the steering files are large.
- **Information access.** Was a key piece of information out of the agent's reach? Examples: dev server logs, read-only access to a third-party service. Use when the agent lacked a fact it needed.

## 4. Present

List the candidates from most to least severe. For each one give: the category, the evidence from the session, the proposed change (file and wording, or the check to add), and what it prevents. Say plainly which candidates rest on one event only. Do not edit any file unless the user asks.

## Reference

### Implementation and review

All work passes two stages. The implementation agent carries the most **context pressure**: it explores, writes code, and debugs. The review agent carries the least: it receives a diff, needs no exploration, and often does not write code. So put the enforcement of coding standards on the review agent, not on the implementation agent.

### Where things go

- `CLAUDE.md` (and `AGENTS.md`, if shared): loaded into the context of every agent in the repo. Use it sparingly, mostly for navigation pointers to other files.
- `CODING_STANDARDS.md`: read during review, not during implementation. Add navigation pointers to a docs folder if it grows past about 1,000 lines.
- Docs: reference files that other files point to. Look for an existing doc before writing a new one.
- Skills: the description of a skill is in the model's context only if the skill lacks `disable-model-invocation: true`. Use a skill for knowledge the model should load on its own, or for a command the user types. Follow `writing-for-agents`.

## Done when

- Each candidate has evidence from the session, a named file or check, and a category.
- Mechanical problems point to a check, not to a new written rule.
- No file was changed without the user's request.

## Report

Say which session was read and how. Give the candidates in severity order, then say what you could not check (for example, past sessions you did not read).
