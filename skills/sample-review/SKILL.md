---
name: sample-review
description: Spot-check a random sample of recent commits instead of reviewing every PR first, and turn every repeatable bad pattern found into a guard rule with proof. Use for /sample-review or "สุ่มตรวจ commit", "spot-check what the agents merged today".
disable-model-invocation: true
---

# Sampling review

Reviewing every PR does not scale once agents merge on their own. Sample a few recent commits instead, and make each bad pattern you find impossible to repeat. The review itself changes no code: it produces findings, and fixes go through `/stack-agent:correct`.

## 1. Pick the sample

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sample-commits.mjs"
```

By default it picks 5 commits from the last 24 hours on the current branch. Use `--since "7 days ago"`, `--range main..HEAD`, or `--count N` when the user asks for another window. It prints the seed it used; put that seed in the log so the same sample can be drawn again with `--seed`.

If nothing matched, tell the user and ask whether to widen the window. Do not sample outside what they asked for.

Commits marked `!!! GUARD FILE CHANGED` touched `guard-baseline.json` or `guard.config.json`. Review those first: a raised baseline, a removed rule, or a narrowed `files` glob loosens the ratchet and needs a named human approval.

## 2. Review one commit at a time

For each sampled commit, run the `reviewer` agent on that commit alone, with `<sha>~1` as the base (for a root commit, review `git show <sha>`). One commit per agent call keeps the findings tied to a commit. Pass it the plugin script paths if `.stack-agent/bin/` is missing.

During the review:

- Do not edit, commit, revert, or change git state. Findings only.
- Record each finding as: commit, `path:line`, what is wrong, and the rule or check that shows it.

## 3. Sort each finding

- **Repeatable pattern**: the kind of mistake an agent will make again (the same wrong import, query in the wrong layer, missing validation shape). Hand it to `/stack-agent:correct`, which picks the highest level that works and proves the new check fires on this commit. Only count it as "rule added" once that proof exists.
- **One-off**: a real bug with no pattern to enforce. Note the fix needed; the user decides who fixes it.
- **Dismissed**: not actually a problem. Write the reason.

## 4. Log it

Append one row per finding to `.stack-agent/review-log.md`. Create the file with this header if it does not exist:

```markdown
# Sampling review log

| Date | Commit | Finding | Action |
|------|--------|---------|--------|
```

Each row: today's date (`YYYY-MM-DD`), the short sha, the finding with `path:line`, and one action: `rule added: <rule-id>`, `one-off: <what needs fixing>`, or `dismissed: <reason>`. If a sampled commit had no findings, add one row saying `no findings` so the log shows it was looked at. End the run with one row whose Commit is `-`, Finding is `sampled N of M, seed <seed>`, and Action is the command you ran.

Only append. Never edit or delete earlier rows.

## Report

How many commits were sampled out of how many, the seed, the guard-file commits and what you found in them, each finding with its action, and which rules `/stack-agent:correct` added with their proof. Say which commits, if any, you could not review and why.
