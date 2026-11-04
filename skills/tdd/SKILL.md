---
name: tdd
description: Use when the user wants a feature or a bug fix built test-first, or wants tests that keep passing through refactors. Triggers - "tdd", "test-first", "red-green-refactor", "write the test first", "integration tests", "add tests for this", "ทำ TDD", "เขียนเทสก่อนโค้ด", "เขียนเทสให้หน่อย".
---

# Build it test-first, one slice at a time

Tests written after the code describe what the code happens to do. Tests written in a pile before the code describe a guess. Both pass while the behavior is wrong. This skill avoids both with one loop: **red** (a test fails for the right reason), **green** (the least code that passes it), **refactor** (tidy while it stays green), repeated one slice at a time, with every test placed at a seam the user agreed to.

Read `GLOSSARY.md` (if it exists) so test names and interface words match the project's domain language, and read any ADR in `docs/adr/` that covers the area you are touching.

## 1. What a good test is

A good test checks behavior through a public interface and does not care how the code inside is built. The code can be rewritten and the test stays valid. It reads as a specification: "a cart with one valid item checks out as confirmed" says what the system does, and keeps passing through refactors.

`tests.md` has side-by-side examples of good and bad tests. `mocking.md` says what may be faked and how to design for it. Consult both before writing the first test, not after.

## 2. Name the seams and get them confirmed

A **seam** is the place where a module's public interface lives: where behavior can be seen or changed from outside, without reaching into the inside. Tests go at seams. A test at an internal detail breaks on every refactor and proves nothing about what a caller gets.

Nobody can test every path. Agreeing on seams first points the effort at the critical paths and the complex logic instead of every edge case.

Before the first test file is written, and before any source file is edited:

1. Find the public interface for the behavior (an HTTP route, an exported function, a CLI command, a screen). Read the code only as far as needed to find it.
2. Say which seams you will test, in your own message. For each, one line on what it catches and what it misses. Example: "POST /items: catches the validation and the status code; does not catch how the row is stored."
3. Ask the user to confirm them. Wait for the answer. If the user cannot answer (a non-interactive run, nobody present), say in the message that you are proceeding on the named seams because the user is not reachable, and go on.
4. Do not write a test at a seam that was not confirmed or named this way.

If the shape of the interface is itself in question (where the seam belongs, how much the module should hide), call the Skill tool with `name` set to `codebase-design`. It holds the shared vocabulary: module, interface, depth, seam, adapter. It is a reference to read, not a session to run.

## 3. The loop

One slice is one behavior, at one seam, with one test. Do these in order, then start the next slice.

1. **Red.** Write one test for the next behavior. Run it. It must fail, and for the right reason: the behavior is missing, not a typo, a bad import, or a broken setup. Read the failure message before going on. A test that has never been seen failing has not been shown to test anything.
2. **Green.** Write the least code that makes this test pass and no more. Do not add code for a test you have not written. Run the test again and read the result.
3. **Refactor.** With the suite green, remove duplication and fix names in the code you just wrote, and rerun after each change. No new behavior here. A restructuring that reaches beyond this slice is a separate piece of work: use `code-review` or `codebase-design` for it, not this loop.

Each test is a **tracer bullet**: a thin end-to-end path whose result tells you what the next slice should be. The second test is written after the first is green, because by then you know something the first did not tell you.

If no shell is available, write the test and the code in the same order, and do not claim any test ran, passed, or failed. State that nothing was run.

For a bug, the first test is the repro of what the user reported, at the seam where they saw it. If the cause is unknown, start with the `debug` skill and come back here for the fix.

## 4. Mistakes that make tests worthless

- **Horizontal slicing.** Writing every test first and all the code after. The tests check an imagined shape, not behavior, and they lock in a structure before the code has shown what it needs. Alternate one test and one implementation instead.
- **Implementation coupling.** The test fakes an internal collaborator, calls a private method, or checks the result by reaching around the interface (reading the database directly instead of asking the code). The tell: the test fails after a refactor that changed no behavior.
- **Tautology.** The expected value is computed the way the code computes it, so the test passes by construction and can never disagree. Take expected values from something independent: a literal worked out by hand, an example in the spec.
- **Never red.** A test written after the code, or run only once, that has never failed. If it passes the first time you run it, change the code or the expectation to see it fail before trusting it.

## 5. Finish in a Stack Agent project

If `.stack-agent/verify.json` exists, the hooks expect a test or a check for every change in behavior. Confirm the seams as in section 2, write the tests, and before saying the work is done run:

```bash
node .stack-agent/bin/verify.mjs
```

Read its output and report the evidence file path (`.stack-agent/evidence/verify-*.json`). Its "against" step runs the new tests on the code from before your change; a test that passes there did not test your change. See the `verify` skill.

Never commit or push unless the user asked.

## Done when

- Seams were named in your message and confirmed by the user, or you said you were proceeding without a reply and why.
- Each test was seen failing for the right reason before the code that fixes it was written (or you said you could not run tests).
- The final suite is green, and you read that output.
- In a Stack Agent project, the full `node .stack-agent/bin/verify.mjs` passed.

## Report

Say, in this order: the seams tested and whether the user confirmed them; the tests added, one line each; what you ran and what it printed (or that no test could be run here); the verify evidence path in a Stack Agent project; anything not tested and why. Anything not run or not verified is said plainly as such.
