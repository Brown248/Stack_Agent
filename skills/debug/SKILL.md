---
name: debug
description: Diagnose and fix a bug or regression by first making it fail on demand as a verify check or test, then fixing it, so the against step proves the repro catches the bug. Use when something is broken, throwing, failing, or slow, or for "debug this", "แก้บั๊ก", "ทำไมมันพัง".
---

# Debug with a repro that goes red

A bug you cannot make fail on demand is a bug you are guessing about. Everything here hangs on one **repro**: a single command that goes **red** on this bug, the exact symptom the user reported, and green once it is fixed. Build it first; theories come after. Adapted from `diagnosing-bugs` in mattpocock/skills (MIT).

Throughout, redact secrets in anything you show: write `<REDACTED>` in their place.

## 1. Build the repro

Make the repro one of the project's own checks, so verify keeps it and the against step can test it:

- a **check** in `.stack-agent/verify.json` (an HTTP request or a command, see the verify skill), or
- a **test** in the project's test suite.

Pick the narrowest one that reaches the bug: a test at the function that misbehaves, a check that sends the request the user sent, a command with the input that broke. If none reaches it yet, write a small script the check runs.

Run it on the code as it is now: `node .stack-agent/bin/verify.mjs --skip-tests --check <name> --json` (the JSON holds an HTTP check's response body and the server log), or the single test file. Done when you have run it at least once and its output shows the user's symptom (the wrong status, the error text, the wrong output), and a second run gives the same verdict. Show the command and the relevant output lines.

If you cannot make it go red, stop and say so: list what you tried and ask the user for what would reproduce it (an environment, a captured request, a log). Theories without a red repro are guesses, so the next steps wait.

## 2. Shrink it

Remove inputs, steps, and setup one at a time, rerunning after each, and keep only what the failure needs. Done when removing any remaining piece turns it green.

## 3. Hypotheses

Write 3 to 5 ranked hypotheses, each with the prediction that would confirm or refute it: "if X is the cause, changing Y makes the repro pass". Show the list to the user before testing; they often know which one it is. Continue with your ranking if they are away.

## 4. Instrument

Test one prediction at a time. Prefer a debugger or a REPL; otherwise add logs at the boundaries that tell the hypotheses apart, and start every debug line with one tag, `[DEBUG-` plus four random letters or digits and `]`, the same tag for the whole session. While you work, the after-edit guard hook leaves these lines alone; the guard's `no-debug-tags` rule (run by `guard.mjs` and CI) fails on any left in code, and a grep for the tag finds them all.

For a slowdown, measure instead of logging: time the repro before and after each change.

## 5. Fix

Change the code, then run the full verify with no flags: `node .stack-agent/bin/verify.mjs`. Its against step runs your repro on the code the session started from; the repro must fail there and pass now. That is the proof the repro catches this bug. Read the against line and act on it:

- `detecting` names your check, or `tests (...)` with your repro test among the failures in its output: done, go to step 6.
- `FAIL against` or `SKIP against: the changed tests also pass`: the repro passes on the old code. If the bug was already there when the session started, the repro does not reach it: go back to step 1. If this session introduced the bug, the old code is correct, so passing there is expected: keep the repro as a regression check, and make sure the session's change has a check the old code fails (see the verify skill), or say that the bug and its fix are both from this session and show the red run from step 1 as the proof.
- `SKIP against` for another reason (the test imports something the old code lacks, no test command in `verify.json`, a test file outside the kept test globs, `verify.json` missing at the reference commit): the step proves nothing either way. Turn the repro into a verify check if you can, or set `against.keep` for the test's folder; otherwise report the red run from step 1 as the proof and say the against step skipped.

## 6. Clean up

Done when all of these hold:

- the full verify passes, and its against step lists the repro as detecting (or you reported why it cannot, per step 5),
- a grep for your `[DEBUG-` tag finds nothing, and the guard passes,
- throwaway scripts and debug output (log files, captured runs) are deleted, or kept only because a check runs them.

## Report

The repro (its name and command), the red output before the fix, the hypothesis that turned out right and the evidence for it, the fix, and the verify evidence path. If no repro could be built, say so and what you need, and make no fix.
