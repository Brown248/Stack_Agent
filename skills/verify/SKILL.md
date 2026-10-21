---
name: verify
description: Prove a change works by running the test suite and the project's real checks (HTTP requests against a running server, or commands that run the program the way a user would), then report the evidence file. Use before saying any code change is done, fixed, or working, and whenever asked to "verify", "prove it works", "เช็กว่าใช้ได้จริง", "ยิง API", or "test the command".
---

# Verify the change against the real program

"It should work" is not done. Done is a full passing run with an evidence file.

## Steps

1. Check that `.stack-agent/verify.json` exists. If it does not, tell the user to run `/stack-agent:stack-agent-init` and stop.
2. If your change added or changed behavior a user can see, add or update a check in `verify.json` `checks[]` first. Cover the success case and at least one rejection case (bad input, missing auth, unknown flag).
   - **HTTP check** (servers, APIs, web apps): `name`, `method`, `path`, `expectStatus`, and optionally `body`, `headers`, `expectJson` (a subset the JSON response must contain), `expectBodyIncludes`. Needs `baseUrl`, and usually a `server` block that starts the app.
   - **Command check** (CLIs, libraries, scripts, browser test runners, anything): `name`, `command` or `args`, and optionally `expectExit` (default 0), `expectOutputIncludes`, `expectOutputExcludes`, `expectOutputMatches` (a JavaScript regex, case-sensitive) with `expectOutputFlags` (default `m`), `needsServer` (start the server first, e.g. for e2e tests), `cwd`, `env`, `timeoutSec`. Output means stdout and stderr together.
   - A `command` string runs in `cmd.exe` on Windows and `/bin/sh` elsewhere, so quoting differs by OS. For anything with quotes, spaces inside an argument, or shell characters, use `args` instead: `"args": ["python", "-c", "print('hi')"]` runs the program with no shell, one item per argument, the same on every OS. `test` and `server` take `args` too. Give `command` or `args`, not both.
   - `args` has no pipes, `&&`, or globs, and on Windows it runs only `.exe` programs. Keep `command` for `npm`, `npx`, and other `.cmd` or `.bat` scripts.
3. Run the whole thing:

   ```bash
   node .stack-agent/bin/verify.mjs
   ```

   Use `--check <name>` to rerun one check while iterating and `--skip-tests` to skip the suite during that loop. Those runs are recorded as partial. The final run must be the full one with no flags.
   A full run also runs the new checks, and the tests when test files changed, against the code from before your change (`against` step). At least one of them must fail there; a check or test that passes on both does not test your change. If it reports `FAIL against`, add the check or test that the old code fails, usually the rejection case.
4. If something fails, read the failing step's output, fix the cause, and rerun. Never change an expectation to match a wrong result. Change it only when the requirement changed, and say so.
5. If verify says something already answers on the server's port, it is not ours. Do not kill processes you did not start. Change the port in `verify.json` or ask the user.

## Report

- The command you ran and the final `verify: ok` line.
- The evidence file path (`.stack-agent/evidence/verify-*.json`).
- Any check you could not run and exactly why (for example, it needs a third-party API key).

If verification cannot run at all in this environment, record why with `node .stack-agent/bin/verify.mjs --skip "<reason>"` and say plainly that the change is unverified instead of claiming success. If you cannot run commands at all (no Node, a read-only sandbox), end your final message with the line `stack-agent-skip: <reason>` instead; the Stop hook records it. If the user told you not to verify, say that in the reason. Never write `latest.json` or `verify-skip.json` by hand.
