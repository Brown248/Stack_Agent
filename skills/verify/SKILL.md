---
name: verify
description: Use before saying any code change is done, fixed, or working, to prove it with the test suite and the project's real checks (HTTP requests against a running server, or commands that run the program the way a user would). Also whenever asked to "verify", "prove it works", "เช็กว่าใช้ได้จริง", "ยิง API", or "test the command".
---

# Verify the change against the real program

"It should work" is not done. Done is a full passing run with an evidence file.

## Steps

1. Check that `.stack-agent/verify.json` exists. If it does not, tell the user to run `/stack-agent:stack-agent-init` and stop.
2. If your change added or changed behavior a user can see, add or update a check in `verify.json` `checks[]` first. Cover the success case and at least one rejection case (bad input, missing auth, unknown flag).
   - **HTTP check** (servers, APIs, web apps): `name`, `method`, `path`, `expectStatus`, and optionally `body`, `headers`, `expectJson` (a subset the JSON response must contain), `expectBodyIncludes`, `expectHeaders` (header name to text its value must include), `followRedirects` (default `true`; `false` to see a redirect itself), `timeoutSec` (default 10). Needs `baseUrl`, and usually a `server` block that starts the app.
   - **Command check** (CLIs, libraries, scripts, browser test runners, anything): `name`, `command` or `args`, and optionally `expectExit` (default 0), `expectOutputIncludes`, `expectOutputExcludes`, `expectOutputMatches` (a JavaScript regex, case-sensitive) with `expectOutputFlags` (default `m`), `needsServer` (start the server first, e.g. for e2e tests), `cwd`, `env`, `timeoutSec`. Output means stdout and stderr together.
   - A `command` string runs in `cmd.exe` on Windows and `/bin/sh` elsewhere, so quoting differs by OS. For anything with quotes, spaces inside an argument, or shell characters, use `args` instead: `"args": ["python", "-c", "print('hi')"]` runs the program with no shell, one item per argument, the same on every OS. `test` and `server` take `args` too. Give `command` or `args`, not both.
   - `args` has no pipes, `&&`, or globs, and on Windows it runs only `.exe` programs. Keep `command` for `npm`, `npx`, and other `.cmd` or `.bat` scripts.
3. Run the whole thing:

   ```bash
   node .stack-agent/bin/verify.mjs
   ```

   Read its output as it prints, or save it to a file outside the project (the system temp folder). The evidence records the project's files as they were when the run started, untracked ones included, so a file like `verify-out.txt` written into the project and deleted afterwards leaves the evidence stale, and the Stop hook asks for another run.
   Use `--check <name>` to rerun one check while iterating and `--skip-tests` to skip the suite during that loop. Those runs are recorded as partial. The final run must be the full one with no flags.
   A full run also runs the new checks, and the tests when test files changed, against the code from before your change (`against` step). At least one of them must fail there; a check or test that passes on both does not test your change. If it reports `FAIL against`, add the check or test that the old code fails, usually the rejection case.
   If it reports `SKIP against: the changed tests import something the code at ... does not have (<names>)`, your tests use a new export or module, so on the old code they fail before testing anything and prove nothing. Add a check to `verify.json` that fails without your change: if the program already runs the new code, run it the way a user does on an input that reaches it; if nothing calls the new code yet, call it directly with a command check (`"args": ["node", "--input-type=module", "-e", "import { name } from './src/<module>.js'; console.log(JSON.stringify(name(<input>)))"]`, or `python -c "from <module> import name; print(name(<input>))"`) and `expectOutputIncludes` set to the expected result. Then run verify again. The Stop hook asks for this once.
   If it reports `SKIP against: no new or changed checks or tests, but the code changed`, nothing you added tests the change. If it changes behavior, add a test or a check that fails without it and run verify again; if nothing a user can observe changed (a refactor, a rename), say so in your report. The Stop hook asks for this once too.
4. If something fails, read the failing step's output, fix the cause, and rerun. Never change an expectation to match a wrong result. Change it only when the requirement changed, and say so.
5. If verify says something already answers on the server's port, it is not ours. Do not kill processes you did not start. Change the port in `verify.json` or ask the user.

## Report

- The command you ran and the final `verify: ok` line.
- The evidence file path (`.stack-agent/evidence/verify-*.json`).
- Any check you could not run and exactly why (for example, it needs a third-party API key).

If verification cannot run at all in this environment, record why with `node .stack-agent/bin/verify.mjs --skip "<reason>"` and say plainly that the change is unverified instead of claiming success. If you cannot run commands at all (no Node, a read-only sandbox), end your final message with the line `stack-agent-skip: <reason>` instead; the Stop hook records it. If the user told you not to verify, say that in the reason. Never write `latest.json` or `verify-skip.json` by hand.
