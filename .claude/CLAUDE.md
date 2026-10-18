# Stack Agent: working in this repo

This repo is a Claude Code plugin. Read `README.md` for what it is and `docs/traceability.md` for why each file exists.

- Scripts in `scripts/` are plain Node ESM with zero dependencies. Keep it that way: target repos vendor them into `.stack-agent/bin/` and CI runs them without `npm install`.
- Every behavior in `scripts/` has a test in `tests/`. Run `npm test` before you report a change. Run `claude plugin validate . --strict` after touching `.claude-plugin/`, `skills/`, `agents/`, or `hooks/`.
- `examples/sample-backend` is the fixture for tests and evals. Its legacy `module-boundary` violation in `src/modules/reports/controller.js` is deliberate: it is the ratchet demo. Do not "fix" it.
- After editing a skill, rerun its eval case (see `skills/run-evals/SKILL.md`).
- Do not commit, push, or merge unless asked.
