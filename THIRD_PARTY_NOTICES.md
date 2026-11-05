# Third-party notices

## mattpocock/skills

The skills listed here are derived from [mattpocock/skills](https://github.com/mattpocock/skills), copied in on 2026-10-31 from a zip the owner of this repository supplied, and changed since. That project is licensed under the MIT License, reproduced below as that license requires. The copyright line and the permission notice stay with every skill that still carries upstream text.

These skills are this repository's to edit. They are not kept byte for byte, so a newer upstream is read for ideas and carried over by hand, not copied over.

The skills, as folders of `skills/` under the names they have now (the upstream groups `engineering`, `productivity`, and `misc` are flattened, because a plugin finds a skill at `skills/<name>/SKILL.md`):

- **engineering:** `which-skill`, `code-review`, `codebase-design`, `domain-modeling`, `implement`, `implement-spec`, `improve-codebase-architecture`, `pr`, `prototype`, `research`, `retro`, `setup-workflow`, `tdd`, `to-spec`, `to-tickets`, `triage`, `wayfinder`, `step-script`
- **productivity:** `grilling`, `handoff`, `teach`, `to-questionnaire`, `re-explain`, `writing-for-agents`
- **misc:** `git-guardrails`, `migrate-to-shoehorn`, `scaffold-exercises`, `setup-pre-commit`

The upstream folders `in-progress` and `deprecated` were not taken.

How far each skill has moved from upstream. *Rewritten* means the text is new, in this repository's style, with upstream's idea and structure; *edited* means upstream's text with changes:

- **rewritten:** `tdd`, `code-review`, `pr`, `domain-modeling`, `codebase-design`, `prototype`, `research`, `grilling`, `writing-for-agents`, `which-skill`, `setup-workflow`, `triage`, `to-spec`, `to-tickets`, `implement`, `implement-spec`, `wayfinder`, `git-guardrails`, `re-explain`
- **edited:** `handoff`, `retro`, `teach`, `to-questionnaire`, `improve-codebase-architecture`, `step-script`, `setup-pre-commit`, `migrate-to-shoehorn`, `scaffold-exercises`

Renamed so that no name carries the author's: `ask-matt` is now `which-skill`, `setup-matt-pocock-skills` is `setup-workflow`, `wait-what` is `re-explain`, `wizard` is `step-script`, `git-guardrails-claude-code` is `git-guardrails`. Merged: `grill-me` and `grill-with-docs`, two wrappers that only called `grilling`, are now one option inside `grilling`. Folded in: `diagnosing-bugs` is part of Stack Agent's own `debug` (its catalogue of ways to build a repro is `debug/LOOPS.md`, and its human-in-the-loop script is `debug/scripts/hitl-loop.template.mjs`, ported from bash to Node).

What changed beyond wording, in the order it was done:

- `disable-model-invocation: true` on `git-guardrails`, `setup-pre-commit`, `step-script`, `scaffold-exercises`, and `migrate-to-shoehorn`, so Claude never starts them from an ordinary sentence (they install packages, change hooks or settings, or touch `.env`). A person starts them by typing `/stack-agent:<name>`.
- `step-script/template.sh` (code): `write_env` stops with a message if `ENV_FILE` is inside a git work tree and `git check-ignore` does not list it (a tracked file also counts as not ignored); `set_secret` and `set_var` pass `-R owner/repo` (from `WIZARD_REPO`, or `gh repo view`) and print that repository, and skip with a "still to do by hand" line if none can be found. The example stage uses a fictional service.
- `git-guardrails`: the hook is a Node script (`scripts/block-dangerous-git.mjs`) instead of a bash script that needed `jq`; it guards the Bash and PowerShell tools and sees `git -C dir push` and commands inside `bash -c`.
- The tracker, triage labels and domain-docs settings are written by `setup-workflow` to `.stack-agent/workflow/`, not to `docs/agents/` and a block in `CLAUDE.md` or `AGENTS.md`; the skills that use a tracker read them there.
- Text from the issue tracker, a pull request, or a web page is treated as data, not instructions, in the skills that read them.
- In a project that has `.stack-agent/verify.json`, `tdd`, `implement`, `implement-spec`, and `prototype` say to run `node .stack-agent/bin/verify.mjs` (or to record why not) before calling the work done; `implement` and `implement-spec` commit only on a feature branch and never push.
- Facts checked on 2026-11-01 and updated: the Tailwind v4 browser build and Mermaid 12 in the architecture report, `bun.lock`, Prettier 3 defaults and Husky 9 commands in `setup-pre-commit`, `@total-typescript/shoehorn` as a dev dependency, the Next.js 15 `searchParams` promise, how `AGENTS.md` and `CLAUDE.md` are read, `/compact` with a focus, and the `Agent` tool for subagents. GitHub's `gh` flags and the `glab` flags were checked against the installed CLI and the docs and found to be right as upstream had them.

One credit is kept inside a skill: `skills/pr/CREDITS.md` and the `metadata.credits` of `skills/pr/SKILL.md` say the idea of the visual Summary comes from Dex Horthy's `show-me` skill at Humanlayer (MIT, Copyright (c) 2026 HumanLayer); the text in `pr` is new wording.

Stack Agent's own skills (`add-endpoint`, `add-migration`, `api-map`, `correct`, `debug`, `feature-map`, `mine-corrections`, `reflect`, `run-evals`, `sample-review`, `stack-agent-init`, `verify`) are not from there and are under this repository's [LICENSE](LICENSE).

### The license of mattpocock/skills

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
