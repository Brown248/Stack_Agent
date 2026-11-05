# Stack Agent: working in this repo

This repo is a Claude Code plugin and a template others fork. Read `README.md` for what it is, `docs/design-notes.md` for why each piece exists, `docs/customizing.md` for where things live, and `docs/out-of-scope.md` for what was decided against (check it before adding a feature).

- Keep it generic. Nothing here may assume one company, codebase, or language. Project-specific choices belong in a target repo's `.stack-agent/` files or in a preset template.
- Scripts in `scripts/` are plain Node ESM with zero dependencies. Target repos vendor them into `.stack-agent/bin/`, and CI runs them without `npm install`.
- Every behavior in `scripts/` has a test in `tests/`. Create temp folders only through `tempDir()` or `copySample()` / `copyExample()` in `tests/helpers.mjs`, so they are cleaned up. Run `npm test` before you report a change.
- Run `claude plugin validate . --strict` after touching `.claude-plugin/`, `skills/`, `agents/`, or `hooks/`.
- `examples/sample-backend` (Node API) and `examples/sample-cli` (Python CLI) are fixtures for tests and evals. The legacy `module-boundary` violation in `examples/sample-backend/src/modules/reports/controller.js` is the ratchet demo. Do not fix it.
- Docs come in English (`README.md`, `docs/*.md`) and Thai (`README.th.md`, `docs/th/*.md`). Change both together.
- After editing a skill, rerun its eval case (see `skills/run-evals/SKILL.md`).
- Most of the skills in `skills/` are derived from mattpocock/skills (MIT; `THIRD_PARTY_NOTICES.md` lists them and says how far each has moved from upstream). They are ours to edit: keep the MIT notice, and move a skill from *edited* to *rewritten* in that file when its text is new. A newer upstream is read for ideas and carried over by hand. To use this repo's skills while working on it, start Claude Code with `claude --plugin-dir .`.
- Do not commit, push, or merge unless asked.
