---
name: grilling
description: Use when the user wants a plan, design, or idea pressure-tested by questions before anything is built. Triggers - "grill me", "stress-test this plan", "interview me about the requirements", "poke holes in this", "challenge my design", "ถามจี้แผนนี้หน่อย", "ช่วยซักถามให้ชัด", "ลองหาจุดโหว่ให้หน่อย".
---

# Grill the plan until it is shared

A plan that sounds finished usually hides decisions nobody has made yet. The failure is to start building on those gaps, or to guess at them quietly. This skill finds every open decision, puts each one to the user with a proposed answer, and builds nothing until both sides hold the same picture.

## 1. Model the plan as a decision tree

Break the plan into decisions. Many decisions hang off an earlier one: the choice of storage settles which migration questions exist, a yes to "support offline" opens the sync questions. Keep the tree in view and update it after every answer.

The **frontier** is every decision whose prerequisites are already settled. These are the questions you can ask now without guessing what the user will answer to an earlier one. A question that depends on another question still open in this round belongs to a later round.

## 2. Look up facts yourself

A fact about the environment (what the code does today, which tool is installed, what a config says, what a file contains) is your job to find, not the user's. Ask the user only for decisions; whatever you could read yourself, read.

When a frontier question needs such a fact, call the `Agent` tool with a prompt that names the question and the places to look. The subagent starts with an empty context and sees none of this conversation, so the prompt must say everything it needs. Do not wait for it. A running lookup is an unsettled prerequisite: only the questions downstream of it wait; ask the rest of the frontier now.

Decisions are the user's. Preferences, priorities, trade-offs and scope are never looked up; put each to the user and wait.

## 3. Ask one whole round

Put the entire frontier in a single message. Number the questions and give each a title, a body (several paragraphs and lettered choices are fine), and your recommended answer. Use plain labels, no emoji:

```
Q1 - <question title>
<question body, with the choices if there are any>
Recommended - <your answer and a short reason>

Q2 - <question title>
<question body>
Recommended - <your answer>
```

Word every question so that a plain "yes" accepts the recommendation. Write "Use a queue here, yes?" and not "What should we use here?". If you have no real recommendation, say what you would pick under which assumption.

Then stop and wait. Do not answer your own questions, and do not start on the next round before the answers arrive.

## 4. Update the tree and repeat

Each answer changes the tree. Settled decisions push the frontier outward and unlock questions that depended on them; an answer may also remove a branch or add a new one. Recompute the frontier, add the results of any finished lookup, and ask the next round.

If an answer contradicts something you found in the code, say so in the next round and ask which one is right. Do not overrule the user silently and do not accept the answer silently.

## 5. Keeping the glossary and decisions

Write nothing to disk by default. Call the Skill tool with `domain-modeling` once, at the start, when any of these holds:

- the user says "with docs", "update the glossary", or "write the ADR",
- the repo already has a `GLOSSARY.md` or a `docs/adr/` folder.

Follow `domain-modeling` for the rest of the session: record a term when the user and you settle its meaning, and offer an ADR when a decision is hard to reverse, surprising without context, and the result of a real trade-off. Without those triggers, keep the outcome in the conversation only.

## 6. Finish

The session ends when the frontier is empty: every branch of the tree visited, nothing silently assumed. Then write the shared understanding in short numbered form (each decision and its answer, the facts the lookups found, anything left open on purpose) and ask the user to confirm it.

Do not act on the plan until the user confirms. No edits, no commands that change anything, no tickets; if they confirm and want the next move, point them to the fitting skill (`which-skill` lists them).

## Done when

- the frontier is empty and no decision was assumed without being shown to the user,
- every environment fact in the summary came from a lookup, not a guess,
- the user confirmed the written summary,
- nothing was changed in the repo, except files `domain-modeling` wrote because the user asked for them.

## Report

Each closing message gives the shared understanding in the order the tree was settled, then the open items and what was not looked up. If the user has not confirmed yet, say so plainly and ask.
