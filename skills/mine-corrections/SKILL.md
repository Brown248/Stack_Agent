---
name: mine-corrections
description: Use to find the corrections people keep giving agents in this project's past Claude Code sessions. Use for /mine-corrections, "what do I keep correcting", "ขุดบทเรียนจากแชตเก่า", or before writing skills for a repo you have worked in for a while.
disable-model-invocation: true
---

# Mine past sessions for repeated corrections

`reflect` learns from this conversation. This skill learns from the ones before it: the corrections people typed into past sessions in this project, which no single session saw twice. Everything stays on this machine: the script only reads the transcripts Claude Code keeps for the project.

## 1. Collect

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/mine-transcripts.mjs" --json
```

It lists what the user wrote right after an agent reply, in sessions from the last 30 days (`--days N` for another window, `--worktrees` to include sessions run in the project's worktrees), each with the session, the time, and the end of the agent reply it answered. By default it keeps the messages that read like a correction (English and Thai cue words); if that finds fewer than about ten, rerun with `--all` and judge each message yourself. If it says there are no transcripts, tell the user where it looked and stop.

Transcripts can hold secrets someone pasted. Never repeat one: write `<REDACTED>` in its place in anything you show or write.

## 2. Group

Read each message with the reply before it, and drop what is not a correction (a new request, thanks, a question). Group the rest by the mistake behind them, not by wording: "SQL goes in repository.js" and "why is there a query in the controller again" are one class.

A class counts when it appears in at least two different sessions. A class seen in one session only is listed apart as a single observation, with no proposed edit. Never add a class you expect but cannot quote.

## 3. Route each class

For each class, pick the highest level that would have stopped it, as in `reflect` and `correct`:

- a check can enforce it: a guard rule or a test, to be built with `/stack-agent:correct`
- it is a step in a repeated task: an edit to that skill's `SKILL.md`
- a skill exists but was not used when it should have been: a sharper `description` for it
- it is a preference nothing can check: a line in `.stack-agent/rules.md`
- the agent lacked information the repo could give: a map row (`feature-map.md` or `api-map.md`), a script, or a pointer

If the guard or a skill already covers the class and the mistake still happened, say so: that is the more useful finding.

## 4. Propose, then wait

Show one table: class, sessions (how many, with dates), the quoted messages (at most three, redacted), the level and target file, and the exact proposed edit or the hand-off to `/stack-agent:correct`. Then stop and wait for the user to approve. Apply nothing unasked, and hand rule work to `/stack-agent:correct`, which proves the rule fires.

## Report

How many sessions and messages were read, the classes with their table rows, the single observations, and anything you could not use and why.
