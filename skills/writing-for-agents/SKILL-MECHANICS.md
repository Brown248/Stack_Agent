# Skill mechanics

The skill-only part of [`writing-for-agents`](SKILL.md): front matter, who may start the skill, arguments, bundled scripts, and what survives a compaction. How to word the text itself is in `SKILL.md`.

## 1. Front matter

A skill is a folder with a `SKILL.md`. Only `description` is needed for the skill to be useful; every other field is optional.

| Field | What it does |
| --- | --- |
| `name` | Defaults to the folder name. Keep it equal to the folder name. |
| `description` | What the model reads to decide whether to start the skill. See section 2. |
| `when_to_use` | Extra trigger text, joined to `description`. The two together are cut at 1,536 characters. |
| `disable-model-invocation: true` | Only a person can start it. See section 3. |
| `user-invocable: false` | Hides it from the `/` menu. The model can still start it. |
| `argument-hint` | Text shown in the menu, such as `[issue number]`. |
| `arguments` | Names for positional arguments, so the body can use `$name`. |
| `allowed-tools` | Pre-approves those tools for that turn only. It does not restrict the other tools. |
| `disallowed-tools` | Tools the skill may not use. |
| `model`, `effort` | Model and effort level while the skill runs. |
| `context: fork` with `agent` | Runs the skill in a separate subagent with its own empty context. |
| `hooks` | Hooks that are active while the skill runs. |
| `paths` | Limits automatic loading to matching files. |
| `shell` | `bash` or `powershell`, for the commands in the skill body. |

Do not rely on a field's exact behavior from this table alone when the skill depends on it; read the Claude Code docs for the field first, and test the skill.

## 2. The description

The description is the skill's pointer (see `SKILL.md`, section 2), held in the model's context so it can choose the skill. Descriptions of all model-startable skills are listed to the model, so each one costs context on every turn.

- Say when to start the skill, not what the skill does. A description that outlines the procedure gets followed in place of the skill body, and the agent skips the details.
- Write it in the third person, or begin with "Use when". Anthropic advises at most 1,024 characters; Claude Code cuts the description and `when_to_use` together at 1,536.
- Put the situations and the words a person would actually type: a few quoted phrases, plus the same in another language when your users speak one.
- This plugin adds its own limits, checked by `tests/skills.test.mjs`: starts with `Use`, at most 600 characters, and no "step" or "then".
- A skill that overlaps another needs a description that tells the two apart, or the model picks one at random.

## 3. Who may start the skill

Two choices, and they trade the two costs from `SKILL.md`, section 3.

- **Model-startable** (the default). The description is in context, so the model can start the skill by itself, another skill can call it through the Skill tool, and a person can still type `/name` (a plugin skill is typed as `/plugin:name`). You pay context cost in return for the model finding it. A skill whose body is only reference can also serve as one shared home: several skills call it, so the reference lives once. Write a description that carries the trigger cases.
- **Typed-only**: set `disable-model-invocation: true`. The skill has no description in the model's context, and a model call to it through the Skill tool is blocked. Only a person runs it, by typing `/name`. No context cost, but the person must remember it exists, which is memory cost. The description is then a short label for the menu, with no trigger phrases.

Choose model-startable only when the model must reach the skill alone, or another skill must call it. If a person always starts it by hand, make it typed-only.

Two consequences for how skills refer to each other:

- A skill that needs a typed-only skill must not try to call it. It tells the user to type `/stack-agent:<name>` and waits.
- Reference two typed-only skills both need cannot live in either, because neither can call the other. Put it in a plain file in the repo that both skills point to.

## 4. Splitting by who starts the skill

Split off a new model-startable skill only when it has its own trigger word that you actually use in prompts, or when another skill must call it. The new description costs context on every turn, so the separate reach has to be worth it. Otherwise keep the content in the existing skill, or in a sibling file it points to.

## 5. Many typed-only skills

When typed-only skills pile up past what a person remembers, add a menu: one skill that lists the others and when to type each. This repo's `which-skill` is one. A menu can only suggest. The model cannot start a typed-only skill, so the menu names the command and the user types it.

## 6. Arguments

Text typed after the skill name arrives in the body:

- `$ARGUMENTS` is all of it.
- `$0`, `$1`, and so on are the words, by position.
- Named values: list the names under `arguments:` in the front matter and use `$name` in the body.

Add `argument-hint` so the menu shows what to type. Say in the body what the skill does when no argument is given.

## 7. Bundled files and scripts

- Keep `SKILL.md` under 500 lines. Put detail in files one level deep next to it, each pointed to from `SKILL.md` with the case that sends the agent there.
- `${CLAUDE_SKILL_DIR}` is the skill's own folder. Use it to build the path to a bundled script, so the command works wherever the plugin is installed.
- Say for each file whether the agent should **run** it or **read** it. A script the agent reads costs context; a script it runs costs only its output.
- A script handles its own errors: it prints what went wrong and what to try, so the agent does not have to guess. Explain any fixed number in it.
- Do not assume bash. Give the PowerShell form of a command, or say that it needs Git Bash, and use forward slashes in paths.

## 8. What survives a compaction

When a long conversation is compacted, each skill that was loaded keeps only its first 5,000 tokens, within a shared 25,000 for all of them. A rule near the bottom of a long skill can be lost mid-task. Put the rules that must hold for the whole run near the top, and keep the body short.

## 9. Build the test before the long skill

Before writing a long skill, write the cases it must pass: a few real requests and what correct behavior looks like for each. Run them with and without the skill, write the least text that fixes the failures, and rerun after each edit. A skill written first and tested later tends to hold advice the model followed anyway, and to miss what it got wrong. In this plugin the eval runner is the `run-evals` skill, which is typed-only (`/stack-agent:run-evals`).
