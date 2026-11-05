# Ways to build the repro

Read this when step 1 of `SKILL.md` does not hand you a repro at once. The catalogue and the human-in-the-loop script come from `diagnosing-bugs` in mattpocock/skills (MIT), reworked for Stack Agent. Try the options in this order and stop at the first that goes red on the user's symptom.

1. **A failing test** at the narrowest place that reaches the bug: unit, integration, or end to end.
2. **A request or command** against the running project: an HTTP check in `.stack-agent/verify.json`, or the command with the input that broke.
3. **A fixture run.** Run the program on a saved input and compare its output with a known-good copy.
4. **A browser script** (Playwright or similar) that drives the page and asserts on the DOM, the console, or the network.
5. **A replay.** Save the real request, payload, or event log to a file, and feed it through the code path alone.
6. **A throwaway harness.** Start the smallest part of the system that holds the bug (one service, dependencies faked) and call it once.
7. **A property or fuzz loop.** For "sometimes wrong", run a thousand random inputs and print the first that fails.
8. **A bisection harness.** For "it used to work", script "check out state X, run the check" and let `git bisect run` do the search.
9. **A differential run.** Send the same input to the old and the new version (or two configs) and diff the outputs.
10. **A human in the loop**, last. If a person must click, drive them with `scripts/hitl-loop.template.mjs` (below), so the loop is still structured and its answers come back as text.

## Make the loop tighter

A loop is a product. Once it fails on the right symptom, improve it before you theorise:

- **Faster.** Cache the setup, skip unrelated start-up, narrow the test to one file.
- **Sharper.** Assert on the specific symptom, not "did not crash".
- **More deterministic.** Pin the clock, seed the random generator, isolate the file system, freeze the network.

A loop that takes thirty seconds and flakes is barely better than none; one that takes two seconds and never flakes is the fastest way to the cause.

## A bug that fails only sometimes

Aim for a higher failure rate, not a clean repro. Run the trigger in a loop, in parallel, under load, with sleeps injected to widen the timing window. Measure the rate with `node .stack-agent/bin/verify.mjs --check <name> --repeat 20`. Half of the runs failing can be worked on; one in a hundred cannot, so keep raising the rate.

## Slow code and regressions in speed

Logs mislead here. Take a baseline first (a timing harness, the profiler, the query plan), then bisect: change one thing, measure again. Measure first, fix second, and put the numbers in the report.

## The human-in-the-loop script

`scripts/hitl-loop.template.mjs` is a Node script (Node 22 or newer, no packages). Copy it to a scratch folder, edit the steps, and ask the person to run it in their own terminal, because the agent's shell cannot answer prompts:

```
node hitl-loop.template.mjs
```

It shows each instruction, waits for Enter, asks each question, and ends by printing the answers as `KEY=VALUE` lines. Ask the person to paste that block back. `capture` prints the answer, so ask for observations only; leave signing in and typing passwords to the person as a `step`.

## When no loop can be built

Say so plainly. List what you tried, and ask for one of: access to the environment that reproduces it, a captured artifact with secrets removed (a HAR file, a log, a core dump, a screen recording with timestamps), or permission to add temporary instrumentation where it happens. Do not move on to hypotheses without a loop.
