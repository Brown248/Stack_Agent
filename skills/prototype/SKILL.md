---
name: prototype
description: Use this first, before writing any real code, when the user wants to see or feel an idea in throwaway code. Triggers - "prototype this", "mock up two layouts", "build a quick throwaway version", "try a few UI variations", "try it in a scratch file", "does this logic feel right", "what should this look like", "ทำต้นแบบ", "ลองทำแบบร่างให้ดูหน่อย", "ขอดูหลายแบบ".
---

# Build a throwaway prototype that answers one question

Some design questions cannot be settled by talking. A state model looks fine on paper and feels wrong once someone pushes real cases through it. Three layouts look equally good in the head and very different on a screen. A prototype is code written to answer exactly one such question and then be thrown away. Two failure modes ruin it: it answers a different question than the one asked, or it quietly turns into production code with no tests. This skill prevents both.

## 1. State the question

Write the question in one sentence before any code exists. Put the same sentence at the top of the prototype where a reader sees it (a visible intro in a page, a top-of-file comment in a source file). Everything built afterwards serves that sentence and nothing else. A feature that does not help answer it does not go in.

## 2. Pick the kind

Decide which question is being asked, from the user's words and the code around it. Ask when the user is there to answer.

- **"Does this logic or state model feel right?"** Read `LOGIC.md` in this folder. It builds one self-contained HTML file that a non-developer can click through, driving a pure state module through the cases that are hard to reason about on paper.
- **"What should this look like?"** Read `UI.md` in this folder. It builds several structurally different versions of one screen, switchable in the browser with a URL parameter and a floating bar.

The two kinds produce different artifacts, so a wrong pick wastes the whole prototype. When the question is unclear and nobody can answer, use the nearer fit to the surrounding code (a backend module means logic; a page or component means UI) and write the assumption at the top of the prototype.

## 3. Rules for both kinds

1. **Mark it as a prototype.** Put the code next to the module or page it informs, so the context is obvious, and name it so a casual reader sees at once that it is not production (a `prototype` folder, a `prototype` word in the file name). For a throwaway route or file, follow the project's existing layout; do not invent a new top-level structure.
2. **Start it with one command.** A UI prototype runs from one of the project's own commands (read the `scripts` in `package.json`, the Makefile, or the README for the runner; do not assume a package manager). A logic demo is one HTML file opened by double-click. Whoever runs it should not need instructions.
3. **Keep state in memory.** Persistence is something a prototype may be checking, never something it relies on. When the question is about a database or a file, use a scratch database or file whose name says `PROTOTYPE, wipe me`, and never the real one.
4. **No tests, no polish.** Skip tests, error handling beyond what keeps it runnable, and abstractions. A prototype that needs tests has stopped being one. Speed of learning is the only goal.
5. **Show the state.** After every action (logic) or every variant switch (UI), print or render the full relevant state, so the person watching sees what changed.
6. **Work on a throwaway branch.** If the project is a git repository and the work is on the default branch, create a branch first (`git switch -c prototype/<name>`); the default branch must never receive prototype code. Commit on that branch only when the user asks for a commit, and never push.
7. **Finish cleanly in a Stack Agent project.** When `.stack-agent/verify.json` exists, the Stop hook asks for evidence whenever code changed, and a prototype has none by design. Either delete the prototype before finishing, or keep it on its throwaway branch and finish with:

   ```bash
   node .stack-agent/bin/verify.mjs --skip "throwaway prototype, not verified"
   ```

   Then say plainly in the report that the prototype is unverified. If you cannot run commands, end the final message with the line `stack-agent-skip: throwaway prototype, not verified`.

## 4. Hand it over

Give the user what they need to look at it: the file to open, or the URL and the variant keys. Tell them which question it answers. The useful feedback tends to be a surprise ("that should not be possible", "I want the header from B and the sidebar from C"). If they ask for another action, scenario, or variant, add it. Prototypes grow until the question is answered.

## 5. Capture the answer, then remove or promote

When the question is answered, record two things: the answer (the verdict, and the one-sentence question it settled) and the prototype itself, because the full set of variants or scenarios is the evidence for the verdict.

- **The answer** goes where the team keeps decisions: the implementation issue (the tracker is described in `.stack-agent/workflow/tracker.md` when `setup-workflow` has been run), a commit message the user asked for, or a `docs/adr/` record if the decision is hard to reverse. Write to an issue only if the user asked; otherwise put the text in the report for them to paste.
- **The prototype** stays on its throwaway branch as a reference, with the branch name in the report. The default branch keeps only the validated decision. A prototype or a switcher left on the default branch rots fast and confuses the next reader.
- **Promoting** the idea into the real code means rewriting it test-first with the `tdd` skill (call the Skill tool with `name: "tdd"`). The prototype is the reference for the rewrite. Never merge or copy prototype code into production as it is: it was written without tests and without error handling.

## Done when

- The question is written at the top of the prototype and the user has been told what it answers.
- The prototype runs from one command or one file.
- No prototype code sits on the default branch; it is deleted, or on its throwaway branch, as the user prefers.
- In a Stack Agent project, the final run recorded either a deletion (no code left) or the `--skip` reason above.
- The answer to the question, or the fact that it is still open, is stated.

## Report

Say, in this order: the question; what the prototype showed, or that the user still has to try it; the branch or folder it lives on and how to run it; what you left out on purpose; and that the prototype has no tests and is unverified. If you could not run something (a dev server, a browser), say so plainly instead of claiming it works.
