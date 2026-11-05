---
name: writing-for-agents
description: Use when writing or fixing any text an agent reads and should follow. Use for "write a SKILL.md", "rewrite this CLAUDE.md", "add this to AGENTS.md", "the agent ignores my instructions", "make the agent follow this", "เขียน skill", "แก้ CLAUDE.md", "agent ไม่ทำตามที่เขียนไว้".
---

# Write instructions an agent follows

This covers every document an agent reads: a skill, a `CLAUDE.md`, an `AGENTS.md`, a doc that one of them points to. A document cannot make the agent produce the same output twice, but it can make the agent take the same path each run. The rules below are the levers. For the extra rules that apply only when the document is a skill (front matter, invocation, bundled scripts), read [`SKILL-MECHANICS.md`](SKILL-MECHANICS.md).

## 1. Choose the home for the rule

Decide this before writing a word.

1. **A rule a script can check** (a banned import, a file location, a forbidden call) does not belong in an instruction file. An agent can skip a sentence; it cannot skip a failing check. In Stack Agent that rule becomes a guard rule or a test, and the `correct` skill builds it. That skill is typed-only, so tell the user to type `/stack-agent:correct`.
2. **A judgment call nothing can check** (naming taste, when to ask first, how to structure a change) belongs in an instruction file.
3. **A fact the project already states** (a script in `package.json`, a config value, the folder layout, `--help` output) belongs nowhere in the document. Section 9 explains why.

Where the instruction files live in Claude Code:

- `CLAUDE.md` in the project, and a personal one in `~/.claude/CLAUDE.md` for every project.
- `AGENTS.md` is read natively only when the project has no `CLAUDE.md`. To share one file between tools, make the first line of `CLAUDE.md` `@AGENTS.md` and keep the shared text in `AGENTS.md`.
- Text in these files is loaded on every turn. Section 3 covers what that costs.

## 2. Use pointers for material the agent needs only sometimes

A **pointer** is a line in always-loaded text that names material kept elsewhere and says when to go there. A skill's description is a pointer. So is a line in `CLAUDE.md` that says "for database changes, read `docs/db.md`". The wording of the pointer, not the target, decides whether the agent goes and how reliably.

If a must-have target is behind a pointer the agent skips, reword the pointer first. Copy the material into the always-loaded file only if rewording fails.

A pointer does two jobs: it says what the material is, and it lists the **cases** that should send the agent there (a case is one kind of situation the document handles). Keep it short, because it costs context on every turn:

- Put the most telling word first. The start of the line is what triggers the lookup.
- One trigger per case. Two phrases for the same case are one case written twice; keep the one the agent is likelier to meet.
- Drop anything the target's own title already says.

## 3. Count the two costs

Every document or pointer you add spends one of two things:

- **Context cost.** Text that sits in the agent's window every turn, such as an `AGENTS.md` line or a skill description, uses room and attention whether or not it applies. Check `/context` to see what a session loads.
- **Memory cost.** The person has to remember that a document exists and when to ask for it. Spend it where human judgment matters; remove it where it does not.

Material reached through a pointer pays only for the pointer's line. Material with no pointer at all costs the person's memory and nothing else.

## 4. Place each piece on the ladder

A document holds two kinds of content: **steps** (what the agent does, in order) and **reference** (definitions, rules, facts looked up when needed). A document may be all steps (a recipe), all reference (a set of review rules), or both. Place each piece on one of three rungs, from most to least immediate:

1. **Steps in the main file.** What the agent does, in order.
2. **Reference in the main file.** Looked up as needed. A flat list of peer rules, such as every rule of a review, is a fine arrangement.
3. **Reference in a separate file**, reached by a pointer and loaded only when the pointer fires. It can be a sibling file in the same folder or any doc in the repo.

Move too little down and the top file bloats. Move too much and the agent never sees what it needs. Use branching as the test: keep in the main file what every case needs, and move out what only some cases need. When reference that belongs on a lower rung sits between steps, the agent attends to the steps unevenly; moving it out is a reliability fix, not a tidiness one.

Two rules follow from the ladder:

- **Keep related material together.** A concept's definition, rules, and caveats go under one heading, so reading one part brings its neighbours along. Scattering one idea across many places is as bad as repeating it.
- **Stop a file from sprawling.** A document that is simply too long loses attention on every line, even when every line is true and unique. Keep a skill's main file under 500 lines, move reference into files one level deep (a file that points to a file that points to another is too deep), and split by case so each path carries only what it needs.

## 5. Match the freedom to the risk

How exactly to word an instruction depends on how much can go wrong:

- **Wide choices, low risk** (code review, naming, where to look first): give the goal and the criteria. Let the agent choose the route.
- **A preferred way with some variation allowed**: give a template or a worked example and say which parts may change.
- **Fragile or irreversible work** (a migration, a release, a data fix): give the exact command and the exact order, in a code block.

Give one default and one way out ("use `pytest`; if the project uses another runner, use that"), not a menu of equals. A menu makes every run pick differently.

## 6. End each step on a finish line

Every step ends on a **completion criterion**: the condition that tells the agent the work is done. It has two properties:

- **Clarity.** Can the agent tell done from not done? A vague bound such as "understanding reached" invites **finishing early**, where the agent's attention drifts to being done while the visible steps ahead pull it forward. Defend in this order. First, make the bound observable ("the test fails with the user's error text"). Only if it stays fuzzy and you actually see the rush, hide the later steps by splitting the sequence. Hiding works only across a real context boundary: a subagent started with the `Agent` tool, which begins with an empty context and sees none of the conversation, or a fresh session. Calling another skill in the same conversation leaves the later steps in view.
- **Demand.** How much the criterion requires. "Every modified model accounted for" makes the agent dig where "produce a change list" does not. Demand is not tied to steps: "every rule applied" works on a flat list of reference as well.

The strongest criteria are checkable and cover everything: a command whose output proves it, a list with nothing left on it.

When the document already has steps, a finish line says how the existing step ends; it does not add work. Take it from the step's own command (its exit code, its output). A check that needs a command the document did not have, a new step, or a new stop condition changes the procedure, not the wording: put it in the report as a suggestion and leave the steps as they were. The same goes for reordering steps or merging two of them.

Split by sequence only when later steps tempt the agent to rush the current one; merging two sequences exposes each one's later steps to the other.

## 7. Anchor with words the model already knows

An **anchor word** is a short, familiar concept the agent thinks with while it runs the document: _red_ for a failing check, _tracer bullet_ for a thin end-to-end slice, _seam_ for a place where behavior can be swapped. A word repeated as a single token collects a meaning across the document and pulls in what the model already knows, in far fewer tokens than a sentence. A word you invent carries nothing and must be defined at full price, so reach for an existing word first. Use the same word in your prompts, your docs, and the code; the agent then links the shared language to the material.

Look for an idea spelled out at several places, or a pointer that spends a sentence on one concept. Each can collapse into one word:

- "fast, deterministic, and cheap to run" becomes _tight_.
- "a loop you trust" becomes _red_, which turns a fuzzy gate into one the agent can observe: the loop fails on the bug, or it does not.

Use one term for one thing everywhere. If a document says "endpoint" in one place and "route" in another, the agent may treat them as two things.

## 8. State the target, not the ban

A prohibition pulls the forbidden behavior into the agent's attention and makes it more available. "Don't think of an elephant" leaves only the elephant. Write the behavior you want ("write one-line comments") and the banned one is never spoken. Keep a prohibition only as a hard guardrail that cannot be put positively, and pair it with the target ("never write to `main`; open a branch").

## 9. Prune

- **One source for each meaning.** A rule stated in two places costs tokens, doubles the edits, and makes the rule look more important than its rank. Repeating an anchor word on purpose is not duplication; repeating a meaning is.
- **The project already says some things.** `package.json` scripts, config files, the folder layout, and `--help` output are sources of truth. A document that copies them is a **copy that can go stale**. Write down only what the agent cannot find by looking: an unwritten convention, the reason behind a choice, a trap that no config mentions. Leave one-file, one-command lookups to the project, where they stay current.
- **Check each line for relevance.** A line is dead if it never bore on the task (background, or a case that should live in a separate file) or if the behavior it describes has changed. Short documents are easier to keep current. Without a habit of cutting, old lines pile up because adding feels safe and removing feels risky, until the live rules are buried.
- **Cut lines that change nothing.** If the model already does it by default, the line costs room and says nothing. The test is whether the line changes what this model does, not whether a reader finds it sensible. Settle a disagreement about a line by running the document, not by argument. When a sentence fails the test, delete the whole sentence. The test also grades anchor words: one too weak to beat the default ("be thorough" for an agent that is already fairly thorough) changes nothing, and the fix is a stronger word ("relentless"), not a new technique.
- **Add only what the model lacks.** Assume the agent is capable. Explaining what it already knows takes room from what it cannot guess.
- **Keep time-sensitive facts out.** "Before March, use the old endpoint" is wrong from March on. Write the current method; put the old one in a clearly marked section for legacy cases, or leave it out.

## 10. Test the document

Rereading proves little, because you know what you meant. Run it:

1. Pick a real task that the document should change, and run it with and without the document. Compare what the agent did, not what it said.
2. When the agent ignores a line, reword the pointer or the line before adding more text (sections 2, 6, and 8 are the usual causes).
3. For a skill in this plugin, rerun its eval case. The `run-evals` skill is typed-only: tell the user to type `/stack-agent:run-evals`.

## Done when

- Every rule has a home chosen in section 1, and no rule a script could check lives only in prose.
- Each pointer names its cases, and no case appears twice.
- Each step has an observable finish line.
- A rewrite of an existing procedure changed how it is said, not what it does: no step or command was added, dropped, or reordered. Anything you think is missing is in the report as a suggestion.
- No sentence fails the "changes the default behavior" test, and no fact is copied from the project's own files.
- The document was run on a real task, and the behavior matched what it asks for.

## Report

State what the document now does and where each rule lives. Name what was cut and why, and anything you moved to a hook, guard rule, or test. If the document was not run on a real task, say so plainly; it is then untested.
