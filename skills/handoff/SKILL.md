---
name: handoff
description: Write a compact handoff document so another agent can continue this work.
argument-hint: "[what the next session is for]"
disable-model-invocation: true
---

# Hand the work to a fresh agent

A new session starts with an empty context. Without a handoff it repeats exploration, or guesses what was decided. This skill writes one short document that lets the next agent continue.

## 1. Choose the place

Save the document in the OS temp folder, not in the working tree, so it never lands in a commit.

```bash
echo "${TMPDIR:-/tmp}"
```

```powershell
$env:TEMP
```

Name the file `handoff-<slug>.md`, where the slug comes from the topic. If the user typed an argument, it says what the next session is for: shape the document around that.

## 2. Write the document

Cover, in this order:

- **Goal.** What the work is for, in one or two sentences.
- **State.** What is done, what is half done, what is not started. Say which checks were run and which were not.
- **Decisions.** What was chosen and why, including options rejected.
- **Next.** The first action for the next agent.
- **Suggested skills.** Which skills the next agent should start. Name only skills that exist (`ls skills`). A skill marked `disable-model-invocation: true` cannot be started by an agent: write "ask the user to type `/stack-agent:<name>`" for those.

Do not copy what another artifact already holds (a spec, plan, ADR, issue, commit, or diff). Give its path or URL instead.

## 3. Redact

Remove API keys, tokens, passwords, private keys, and personal data before saving. Write `<REDACTED>` in their place. Reread the file once for anything that slipped in.

## Done when

- The file exists in the OS temp folder and holds the five parts above.
- It contains no secret and no personal data.
- Nothing in it duplicates a spec, commit, or diff that can be linked.

## Report

Give the full path of the file and one line on what the next session should do first. Say plainly if anything in the file could not be confirmed.
