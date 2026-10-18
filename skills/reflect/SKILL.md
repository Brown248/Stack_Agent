---
name: reflect
description: After a task, review what went wrong or took too long in this conversation and turn durable lessons into edits to the repo's skills, rules, or guard. Use for /reflect or "สรุปบทเรียน", "update the skill so this doesn't happen again".
disable-model-invocation: true
---

# Reflect and improve the skills

A prompt is gone when the chat closes. A skill keeps the lesson. This turns one session's lessons into a permanent change, with the user's approval.

## 1. Collect candidates

Go through this conversation and list each moment where:

- the user corrected you or repeated an instruction,
- a step failed and you had to retry,
- you searched for something a skill or the API map should have told you,
- a check (guard, verify, api-map) caught something late.

Skip one-offs that will not happen again.

## 2. Route each lesson to the right home

For each candidate, decide the highest level that would have prevented it:

- A check can enforce it → a guard rule or test (hand it to `/stack-agent:correct`).
- It is a step in a repeated task → an edit to that skill's `SKILL.md`.
- The skill did not trigger when it should have → tighten that skill's `description`.
- It is a team preference → `.stack-agent/rules.md`.
- It is code an agent keeps rewriting → a script inside the skill's folder, called from the skill.

## 3. Propose, then wait

Show a table: lesson, evidence (what happened in this chat), target file, exact proposed edit. Then stop and wait for the user to approve. Skill changes affect every future session, so never apply them unasked.

## 4. Apply what was approved

Make only the approved edits. If you edited a skill that has an eval case under `evals/`, tell the user to rerun the evals (see the run-evals skill) before relying on the change.
