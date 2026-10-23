---
name: correct
description: Use when agents keep making the same mistake in this repo and it should become impossible to repeat. Use for /correct or "ทำให้ไม่พลาดซ้ำ", "turn this review comment into a rule".
disable-model-invocation: true
---

# Correct repeated mistakes

The goal is that the next agent cannot make the mistake, not that it is told not to.

## 1. Find the mistake classes

Read, in this order: what the user just corrected in this conversation, recent review comments, reverts and "fix" commits (`git log --oneline -50`), and workaround comments in the code. Group them into classes. A class counts once it happened at least twice, or once if the user says so. Each class needs concrete observations you can cite: the commit, file and line, review comment, or failing output. A class you expect might happen, with nothing you can point to, is not a class.

## 2. Fix each class at the highest level that works

1. **Architecture.** One owner per piece of state, one supported way per task. Delete the old way an agent would copy.
2. **Types.** Make the bad state impossible to write.
3. **Guard rule.** Add a rule to `.stack-agent/guard.config.json`. Its `fix` must name the file, function, or module to use instead. If the pattern already exists in many places, keep the ratchet: run `node .stack-agent/bin/guard.mjs --update-baseline` once so old cases are recorded and only new ones fail.
4. **Test.** Assert the behavior a client sees.
5. **Docs or `.stack-agent/rules.md`.** Only for judgment calls nothing can check.

## 3. Prove each new check

Show that the check fails on the real past mistake: point it at the old commit or file (`git show <sha>:<path> > /tmp/x` and run the guard on a copy, or use `--strict`), or add a fixture that reproduces it. A rule that never fired on a real mistake is unproven. Say so if you could not prove it.

## 4. Keep the rule table

Add a row to `.stack-agent/rules-table.md`: rule, why, what enforces it, and the proof. If the rule was already in the table but only docs enforced it, that is a repeat. Move it up a level in the same change.

Raising the baseline (`--allow-increase`) and editing `guard.config.json` or `guard-baseline.json` need the user's approval, and the hooks ask for it. Inline exceptions must use `stack-agent-allow <rule-id> reason="..." until=YYYY-MM-DD by=<approver>`. The date must be within `maxAllowDays` (90 by default), and the exception stops working after it.

## Report

Each class with its cited observations, the level you chose and why a higher level did not work, and the proof that the check fires.
