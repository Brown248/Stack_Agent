---
name: sample-review
description: Use to spot-check a random sample of recent commits instead of reviewing every PR, and to find the bad patterns worth a guard rule. Use for /sample-review or "สุ่มตรวจ commit", "spot-check what the agents merged today".
disable-model-invocation: true
---

# Sampling review

Reviewing every PR does not scale once agents merge on their own. Sample a few recent commits instead, and make each bad pattern you find impossible to repeat. The review itself changes no code: it produces findings, and fixes go through `/stack-agent:correct`.

## 1. Pick the sample

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/sample-commits.mjs"
```

By default it picks 5 commits from the last 24 hours on the current branch. Use `--since "7 days ago"`, `--range main..HEAD`, or `--count N` when the user asks for another window. It prints the seed it used; put that seed in the log. With the ledger below, the same seed draws the same sample only from the log as it was before this run's rows were added, so the log row records the seed for the record, not as a way to redraw.

The review log (step 4) is also the ledger: commits it already lists are not picked again, and commits that touch files no reviewed commit has touched are picked before the rest, so each run covers ground the last ones did not. Say in the report how many were skipped as already reviewed. Use `--no-ledger` only when the user asks for a purely random sample.

If nothing matched, tell the user and ask whether to widen the window. Do not sample outside what they asked for.

Commits marked `!!! GUARD FILE CHANGED` touched `guard-baseline.json` or `guard.config.json`. Review those first: a raised baseline, a removed rule, or a narrowed `files` glob loosens the ratchet and needs a named human approval.

## 2. Review one commit at a time, in a checkout of that commit

Read, Grep, and Glob only see the files on disk, so reviewing commit X in the main working tree reads today's code. Review each sampled commit in its own checkout. Use the absolute path of the plugin's scripts folder (`${CLAUDE_PLUGIN_ROOT}/scripts`) in every command you hand to an agent; agents may not expand the variable.

Pick a run folder: `.stack-agent/evidence/review/<YYYY-MM-DD>-<seed>/` (gitignored with the rest of the evidence folder). For each sampled commit `<sha>`:

1. **Checkout.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/review-worktree.mjs" add <sha> --json` prints `root` (the review root) and `tmp`.
2. **Find.** Run the `reviewer` agent with the review root, the range `<sha>~1..<sha>` (for a root commit, just `<sha>`), the plugin scripts path, and the commit message as the spec (`git -C <review root> log -1 --format=%B <sha>`; the reviewer cites it as `commit-message`). Save its `json` block as `<sha>.candidates.json` in the run folder and check it: `node "${CLAUDE_PLUGIN_ROOT}/scripts/review-findings.mjs" validate <file> --stage candidates --root <review root>`. If it is invalid, ask the reviewer once to fix the listed problems; if it is still invalid, log it as `not reviewed: reviewer output unusable` and move on. If the reviewer says it could not read the diff, this commit was not reviewed: log it as `not reviewed: diff could not be read` (not `no findings`) and move on.
3. **Mechanical candidates** (`source` `guard:<rule-id>`, `api-map`): rerun the check yourself in the review root and keep the reviewer's location and evidence. If it fails as claimed, record it as `confirmed`, `severity` `blocking`, `kind` `one-off` (the check already exists), `observed` with the command and the relevant output lines, `fix` from the check's message. If it passes, record it as `rejected` with the output as `reason`. Either way set `found_by` `reviewer` and `verified_by` `script:<the command>`.
4. **Verify judgment candidates** (`rules.md:<line>`, `standards:<file>:<line>`, `correctness`, `spec`): run one `finding-verifier` agent per commit with the review root, the range, and the candidates reduced to `id`, `commit`, `title`, `claim`, `location`, `source`, and `spec` where present, plus the commit message for `spec` candidates. Never pass the reviewer's evidence. Across the whole run, verify at most 8 candidates; any beyond that become `needs_validation` with the blocker "not verified: over the per-run limit of 8", `how_to_check` "verify by hand", and `verified_by` `none (over the limit)`, keeping the reviewer's location, evidence, and `spec`.
5. **Merge.** Take each verifier record by `id` and set `found_by` to `reviewer` and `verified_by` to `finding-verifier` yourself; agents never set these. A verifier answer that is not one valid `json` block, or leaves a candidate out, is asked for once more from a fresh `finding-verifier` (for the missing candidates only); if that fails too, each unanswered candidate becomes `needs_validation` with the blocker "verifier output unusable", `how_to_check` "verify by hand", and `verified_by` `finding-verifier (output unusable)`, keeping the reviewer's location, evidence, and `spec`. If the verifier answered with an empty array because it could not read the diff, do not retry: each candidate becomes `needs_validation` with the blocker "the verifier could not read the diff", `how_to_check` "rerun the review where git can run", and `verified_by` `finding-verifier (diff unreadable)`, keeping the reviewer's location, evidence, and `spec`. If the check in step 6 says a verifier record cites no file the commit changed, add the reviewer's evidence entries for that id that do; that, and `spec` on a spec finding, are the only fields you may copy across.
6. **Check.** Write the merged records to `<sha>.findings.json` and run `review-findings.mjs validate <file> --stage final --root <review root> --candidates <sha>.candidates.json`. It checks the fields each verdict needs, that finder and verifier differ, that every quoted excerpt is at its cited line in that commit, and that every candidate has exactly one final record. Fix only what it lists, from the agents' own answers; do not invent fields.
7. **Clean up.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/review-worktree.mjs" remove <tmp>`, even when a step failed.

During the review do not edit, commit, revert, or change git state in the project. Findings only.

## 3. Act on each finding

- `confirmed`, `kind` `repeatable`: hand it to `/stack-agent:correct`, which picks the highest level that works and proves the new check fires on this commit. Only count it as "rule added" once that proof exists.
- `confirmed`, `kind` `one-off`: a real problem with no pattern to enforce. The user decides who fixes it.
- `hardening`: not a problem today, because another layer (`control`) stops it. List the `suggestion` under its own heading in the report, apart from the problems; nobody has to act on it.
- `needs_validation`: list the blockers for the user; nobody acts on it until the unknown fact is checked.
- `rejected`: nothing to do; the reason is logged.

## 4. Log it

Append rows to `.stack-agent/review-log.md`. Create the file with this header if it does not exist:

```markdown
# Sampling review log

| Date | Commit | Finding | Action |
|------|--------|---------|--------|
```

For each commit, append the rows printed by `node "${CLAUDE_PLUGIN_ROOT}/scripts/review-findings.mjs" rows <sha>.findings.json --date <YYYY-MM-DD>`. For a commit with no rows from `rows`, write one row yourself, with the reason in the Action column:

- no candidates: `| <date> | <sha, first 12> | no findings | no findings |`
- the reviewer could not read the diff: `| <date> | <sha, first 12> | - | not reviewed: diff could not be read |`
- the reviewer's output stayed unusable: `| <date> | <sha, first 12> | - | not reviewed: reviewer output unusable |`

The ledger counts a commit as reviewed unless its Finding or Action starts with `not reviewed`, so use these exact words. When `/stack-agent:correct` proves a rule for a repeatable finding, append a row with the action `rule added: <rule-id>`. End the run with one row whose Commit is `-`, Finding is `sampled N of M, seed <seed>`, and Action is the command you ran.

Only append. Never edit or delete earlier rows.

## Reviewing the current change instead

When the user asks to review the change they are working on rather than a sample, skip the checkout: the review root is the project folder, the range is `HEAD` (uncommitted work) or the branch range they name, and `commit` is `worktree`. For the spec, copy what the user asked for (their words, or the issue they name) into `spec.md` in the run folder and give the reviewer that path relative to the project folder; give the verifier the same file with the `spec` candidates. The reviewer also runs `verify.mjs --evidence-status`; a `verify-evidence` candidate is mechanical like a guard one, so handle it in step 2.3 by rerunning that command. Then follow steps 2.2 to 2.6 with `--root` set to the project folder and the run folder `.stack-agent/evidence/review/<YYYY-MM-DD>-worktree/`, and report the findings without logging them.

## Report

How many commits were sampled out of how many, the seed, the guard-file commits and what you found in them, the counts of confirmed, hardening, needs_validation, and rejected findings, each confirmed finding with its action, and which rules `/stack-agent:correct` added with their proof. Say which commits, if any, you could not review and why, and how many candidates went unverified because of the limit.
