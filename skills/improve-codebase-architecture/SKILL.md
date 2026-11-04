---
name: improve-codebase-architecture
description: "Scan a codebase for deepening opportunities and show them as an HTML report."
disable-model-invocation: true
argument-hint: [area or pain point, optional]
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities**: refactors that turn shallow modules into deep ones. The aim is testability and easier navigation for people and agents.

This skill is informed by the project's domain model and built on a shared design vocabulary:

- Call the Skill tool with `name` set to `codebase-design` for the architecture vocabulary (**module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**) and its principles (the deletion test, "the interface is the test surface", "one adapter is a hypothetical seam, two is a real one"). Use these terms exactly in every suggestion. Do not drift into "component", "service", "API" or "boundary".
- The domain language in `GLOSSARY.md` gives names to good seams. ADRs in `docs/adr/` record decisions this skill must not re-argue.

The failure mode is a list of refactors nobody can judge: vague names, no evidence, no picture. Each candidate below must point at real files and say what was read to reach it.

## 1. Explore

Decide where to look before looking. Deepening a module pays off by making future changes to it easier, so weigh the parts of the codebase that changed recently.

- If the user named a direction (a module, a subsystem, a pain point), take it and skip the history inference below.
- Otherwise read a good stretch of history (`git log --oneline`, optionally with `--name-only`) to find hot spots: files and areas that keep coming up. Look there first. If the changes are scattered with no clear hot spot, widen the search.

Read `GLOSSARY.md` and any ADRs for the area first.

Then launch a subagent with the `Agent` tool to walk the codebase. A subagent starts with an empty context and sees none of this conversation, so put in its prompt: the area to cover, the vocabulary above, the friction questions below, and a request to return file paths with one line of evidence each. Do not hand it a rigid checklist; ask it to explore and note where it feels friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow**, with an interface nearly as complex as the implementation?
- Where were pure functions extracted only for testability, while the real bugs hide in how they are called (no **locality**)?
- Where do tightly coupled modules leak across their seams?
- Which parts are untested, or hard to test through their current interface?

Apply the **deletion test** to anything suspected of being shallow: would deleting it concentrate complexity, or only move it? "Concentrates" is the signal wanted. Open the files yourself before putting a candidate in the report; a subagent's claim is a lead, not evidence.

## 2. Present the candidates as an HTML report

Write a self-contained HTML file to the OS temp folder so nothing lands in the repo. Use `<tmpdir>/architecture-review-<timestamp>.html` so each run gets a fresh file. Resolve the folder from `$TMPDIR` and fall back to the OS temp folder (`/tmp` on macOS and Linux, `$env:TEMP` in PowerShell, `%TEMP%` in cmd). Open the file for the user and tell them its absolute path:

| System | Command |
| ------ | ------- |
| macOS | `open <path>` |
| Linux | `xdg-open <path>` |
| Windows PowerShell | `Start-Process <path>` |

The report loads Tailwind (the v4 browser build) and Mermaid from public CDNs, so it needs a network connection to look right. Without one, build the offline fallback described in [HTML-REPORT.md](HTML-REPORT.md): plain HTML with nested lists and ASCII diagrams, no scripts.

Use Mermaid when relationships are graph-shaped (call graphs, dependencies, sequences) and hand-built divs or SVG for the more editorial pictures (mass diagrams, cross-sections, collapsing calls). Each candidate gets a **before/after visualisation**.

For each candidate, render a card with:

- **Files**: which files and modules are involved (paths that exist).
- **Problem**: why the current architecture causes friction, and the evidence (what was read, or which commits show the churn).
- **Solution**: plain-English description of what would change.
- **Benefits**: in terms of locality and leverage, and how tests would improve.
- **Before / After diagram**: side by side, showing the shallowness and the deepening.
- **Recommendation strength**: one of `Strong`, `Worth exploring`, `Speculative`, shown as a badge.

End the report with a **Top recommendation** section: which candidate to tackle first and why.

Name the domain with `GLOSSARY.md` words and the architecture with `codebase-design` words. If `GLOSSARY.md` defines "Order", write "the Order intake module", not "the FooBarHandler" or "the Order service".

**ADR conflicts.** If a candidate contradicts an existing ADR, surface it only when the friction is real enough to justify reopening the ADR. Mark it in the card with a warning callout, for example _"contradicts ADR-0007, but worth reopening because..."_. Do not list every refactor an ADR forbids.

[HTML-REPORT.md](HTML-REPORT.md) has the full HTML scaffold, diagram patterns and styling guidance.

Do not propose interfaces yet. After the file is written, ask the user: "Which of these would you like to explore?"

## 3. Grilling loop

Once the user picks a candidate, call the Skill tool with `name` set to `grilling` and walk the decision tree together: constraints, dependencies, the shape of the deepened module, what sits behind the seam, which tests survive.

Side effects happen inline as decisions settle. Call the Skill tool with `name` set to `domain-modeling` to keep the domain model current:

- **A deepened module named after a concept missing from `GLOSSARY.md`?** Add the term to `GLOSSARY.md`, creating the file if it does not exist.
- **A fuzzy term sharpened during the conversation?** Update `GLOSSARY.md` right then.
- **The user rejects a candidate for a load-bearing reason?** Offer an ADR: _"Want me to record this as an ADR so future architecture reviews don't re-suggest it?"_ Offer only when a future explorer would need the reason to avoid the same suggestion. Skip ephemeral reasons ("not worth it right now") and self-evident ones.
- **Alternative interfaces for the deepened module wanted?** Call the Skill tool with `name` set to `codebase-design` and use its design-it-twice pattern with parallel subagents.

If the work goes on to change code, run `node .stack-agent/bin/verify.mjs` before calling it done (when the project has `.stack-agent/verify.json`). This skill itself changes no code.

## Done when

- The report file exists in the OS temp folder, and its absolute path was given to the user.
- Every candidate names files that exist and states what evidence backs it.
- Every term in the report is a `codebase-design` or `GLOSSARY.md` term.
- The user was asked which candidate to explore, and no interface was proposed before they answered.

## Report

Say, in order: the path of the report, how many candidates and the top recommendation in one line, the area scanned and how it was chosen (named by the user, or history hot spots), and anything not checked (for example "did not open the Mermaid diagrams in a browser"). End with the question about which candidate to explore.
