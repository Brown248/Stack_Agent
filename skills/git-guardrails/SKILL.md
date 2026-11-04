---
name: git-guardrails
description: Install a hook that refuses dangerous git commands (push, reset --hard, clean -f, branch -D, checkout ., restore .) before they run. Typed as /stack-agent:git-guardrails.
disable-model-invocation: true
---

# Block dangerous git commands with a hook

A PreToolUse hook reads each shell command before Claude runs it and refuses the ones that destroy work or publish it. The hook is a small Node script with no packages, so it needs only Node 22 or newer, the same as Stack Agent itself, and it works on macOS, Linux, and Windows. It guards the Bash and PowerShell tools.

## What it refuses

- `git push`, in every form (including `--force`)
- `git reset --hard`
- `git clean` with `-f`, `-fd`, `-fdx`, or `--force`
- `git branch -D` (and `--delete --force`)
- `git checkout .` and `git restore .`

It sees the command through global options (`git -C dir push`), after `&&` or `;`, and inside `bash -c "..."`. When it refuses, Claude is told it has no authority to run that command and to ask the user.

**In a Stack Agent project** the plugin's hooks already ask before a force-push, `git reset --hard`, `git clean`, and a branch deletion, and they refuse bypasses such as `--no-verify`. This skill turns those into hard refusals and also refuses every plain `git push`, which Stack Agent allows. Remove the patterns you do not want from the script before installing it (step 4).

## 1. Ask the scope

Ask the user: this project only (`.claude/settings.json`), or every project (`~/.claude/settings.json`)? Wait for the answer.

## 2. Copy the script

The script is `${CLAUDE_SKILL_DIR}/scripts/block-dangerous-git.mjs`. Copy it to:

- **Project:** `.claude/hooks/block-dangerous-git.mjs`
- **Every project:** `~/.claude/hooks/block-dangerous-git.mjs` (on Windows, `$HOME\.claude\hooks\`)

Create the folder if it is missing. No `chmod` is needed: the hook runs it with `node`.

## 3. Add the hook to the settings

Merge this into the settings file for the chosen scope. If the file exists, add the entry to its `hooks.PreToolUse` array and leave every other setting as it is.

**Project** (`.claude/settings.json`):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/block-dangerous-git.mjs"]
          }
        ]
      }
    ]
  }
}
```

**Every project** (`~/.claude/settings.json`): the same, with the path to the copied file in `args`, written with forward slashes and the full home folder (for example `C:/Users/you/.claude/hooks/block-dangerous-git.mjs`), because `args` is not read by a shell and `~` is not expanded.

## 4. Ask what to change

Ask whether to add or remove patterns. The rules are in the `RULES` table at the top of the copied script; edit that copy.

## 5. Prove it works

Run this from the project folder and read the result:

```bash
echo '{"tool_input":{"command":"git push origin main"}}' | node .claude/hooks/block-dangerous-git.mjs; echo "exit $?"
```

It must print a line starting `BLOCKED:` and `exit 2`. Then run `echo '{"tool_input":{"command":"git status"}}' | node .claude/hooks/block-dangerous-git.mjs; echo "exit $?"`, which must print only `exit 0`. (In PowerShell, pipe the same JSON with `'{...}' | node ...; $LASTEXITCODE`.)

The settings change takes effect in a new session. Tell the user to start one.

## Done when

- The script is at the chosen place and the settings file holds the hook, with the other settings unchanged.
- The refusal check printed `BLOCKED:` with exit 2, and the harmless command exited 0.

## Report

Say where the script and the settings entry are, which patterns are active (and any you removed), what the two checks printed, and that a new session is needed before the hook applies. Do not commit.
