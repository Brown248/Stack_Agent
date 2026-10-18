---
name: verify-api
description: Prove a backend change works by running the test suite, starting the API locally, and calling real endpoints, then report the evidence file. Use before saying any code change is done, fixed, or working, and whenever asked to "verify", "ยิง API", "เช็กว่าใช้ได้จริง", or "test the endpoint".
---

# Verify the change against the real API

"It should work" is not done. Done is a passing run with an evidence file.

## Steps

1. Check that `.stack-agent/verify.json` exists. If it does not, tell the user to run `/stack-agent:stack-agent-init` and stop.
2. If your change added or changed an endpoint, add or update a check in `verify.json` `checks[]` first. A check has `name`, `method`, `path`, `expectStatus`, and optionally `body`, `headers`, `expectJson` (a subset the response must contain), and `expectBodyIncludes`. Cover the success case and at least one rejection case (bad input, missing auth).
3. Run the whole thing:

   ```bash
   node .stack-agent/bin/verify.mjs
   ```

   Use `--check <name>` to rerun one check while iterating and `--skip-tests` to skip the suite during that loop. The final run must be the full one with no flags.
4. If something fails, read the failing step's output, fix the cause, and rerun. Never change an expectation to match a wrong response. Change it only when the requirement changed, and say so.
5. If the server says something already answers on the port, it is not ours. Do not kill processes you did not start. Change the port in `verify.json` or ask the user.

## Report

- The command you ran and the final `verify: ok` line.
- The evidence file path (`.stack-agent/evidence/verify-*.json`).
- Any check you could not run and exactly why (for example, it needs a third-party API key).

If verification cannot run at all in this environment, say that plainly instead of claiming success.
