---
name: handoff
description: Write a compact handoff document so another agent can continue this work.
argument-hint: "[what the next session is for]"
disable-model-invocation: true
---

# Hand the work to a fresh agent

A new session starts with an empty context. Without a handoff it repeats exploration, drops what the user just asked for, or trusts something this session only assumed. This skill writes one short document that lets the next agent continue.

## 1. Choose the place

If the user names a file or folder, use it. Otherwise save the document in the OS temp folder, not in the working tree, so it never lands in a commit.

```bash
echo "${TMPDIR:-/tmp}"
```

```powershell
$env:TEMP
```

Name the file `handoff-<slug>.md`, where the slug comes from the topic. If the user typed an argument, it says what the next session is for: shape the document around that.

## 2. Read the state; do not recall it

Run these commands and copy what they print. A state written from memory goes stale, or was never true.

- `git branch --show-current`, `git status --short`, and `git log --oneline -5`: the branch, the files left uncommitted, the last commits.
- In a Stack Agent project, `node .stack-agent/bin/verify.mjs --evidence-status`: whether the latest evidence matches the code.
- Processes this session started that are still running (a dev server, a watcher, a container), with the port.

If a command cannot be run here (no shell), write `not checked` beside that item. Never fill it in from memory.

## 3. Write the document

Cover, in this order:

- **Last request.** The user's last request, copied word for word, then `Status: answered`, `partly answered`, or `not answered`. If it is not fully answered, name the file, command, or ticket the next agent should look at first, and say that the request comes before everything below.
- **Goal.** What the work is for, in one or two sentences.
- **State.** The output of step 2, then what is done, what is half done, and what is not started. Say which checks were run and which were not.
- **Decisions.** What was chosen and why, including options tried or rejected and why they were dropped.
- **Assumptions to verify.** One line each, for what this session believed but did not confirm: `<claim> - verify with: <exact command or file>`. Leave the section out if there are none.
- **Next.** The first action for the next agent.
- **Suggested skills.** Which skills the next agent should start. Name only skills that exist (`ls skills`). A skill marked `disable-model-invocation: true` cannot be started by an agent: write "ask the user to type `/stack-agent:<name>`" for those.
- **Confidence.** One line: high, medium, or low, and why.

Do not copy what another artifact already holds (a spec, plan, ADR, issue, commit, or diff). Give its path or URL instead.

## 4. Redact

Remove API keys, tokens, passwords, private keys, and personal data before saving. Write `<REDACTED>` in their place. Reread the file once for anything that slipped in.

## Done when

- The file exists, and holds the parts above that apply.
- The last request is word for word, with its status.
- Every item under State came from a command or says `not checked`.
- Every assumption has a command or file that checks it.
- It contains no secret and no personal data.
- Nothing in it duplicates a spec, commit, or diff that can be linked.

## Report

Give the full path of the file and one line on what the next session should do first. Say plainly if anything in the file could not be confirmed.
