# Logic prototype

One self-contained HTML file that lets anyone drive a state model by clicking buttons. Use it when the question is about business rules, state transitions, or the shape of data: things that look reasonable on paper and feel wrong once real cases go through them.

The file has nothing to install, so it can go to a non-developer (a designer, a product owner, a domain expert) who tries the model by hand. It speaks that person's language, not the code's.

## When this is the right kind

- "Does this state machine handle X followed by Y?"
- "Can this data model represent the case where..."
- "I want to feel out what the API should look like before writing it."
- Any question answered by pressing buttons and watching the state change.

If the question is "what should this look like", use `UI.md` instead.

## 1. State the question

Write which state model is under test and what is being asked, in one paragraph, as a visible intro at the top of the page (a code comment alone is not enough). A logic prototype that answers the wrong question is wasted work, and an explicit question lets someone check it later, whether they watched it being built or come back to it cold.

## 2. Put the logic in a separate module

Write the logic that answers the question as one small module inside a single `<script>` block, written so it could be lifted out later. The page around it is throwaway; the module is the part that carries the answer.

Pick the shape the question needs, not the one easiest to wire to a page:

- **A pure reducer**, `(state, action) => state`. Fits discrete events acting on one value.
- **A state machine** with named states and transitions. Fits questions where "which actions are legal right now" matters.
- **A few pure functions** over a plain data type. Fits logic with no current state, only transformations.
- **A class or module with a clear method surface**, only when the logic truly owns changing internal state.

Keep the module pure: no DOM, no `document`, no button handlers inside it. The page calls the module and the module never calls the page. Mixing them makes the logic impossible to lift out and hides what is being tested.

## 3. Build the HTML file

Plain HTML, CSS and JavaScript, all inline: no framework, no bundler, no server. It must open by double-click and survive being sent by email. Every label uses the domain's words, so buttons and fields read like the business, not like the reducer. Explain in plain sentences what is happening.

Lay it out top to bottom:

1. **Title and a one-line statement** of what the demo lets you explore (the question from section 1).
2. **Current state.** Show the full relevant state as a readable panel with labelled fields, not a raw JSON dump. Render it again after every click, and where it helps, point out what just changed.
3. **Free-play buttons.** One button per action, always available, so anyone can try the model in any order. A click runs the action and redraws the state.
4. **Guided walkthroughs.** One scenario per tab. Each tab has a short plain description (the situation it sets up and what to watch for) and, under it, the ordered buttons to press. Each step is a real button: clicking it performs the action and points to the next step. Starting a walkthrough resets to a known initial state, so it behaves the same way every time.

Choose scenarios that expose the awkward cases: the happy path, a tricky edge case, and an attempt at something that should be refused.

Keep the look plain and tidy: clear type, generous spacing, one accent colour. No animation or decoration that competes with the state and the buttons.

## 4. Hand it over

Send the file or open it for the user. The valuable moments are the surprises ("that should not be possible", "I assumed X would work differently"). Each one is a flaw in the idea, which is what the prototype exists to find. If they want another action or scenario, add it.

## 5. Capture the answer and the prototype

When the question is answered, follow section 5 of `SKILL.md`. For this kind, the validated module is the reference for the real implementation, which is rewritten test-first with the `tdd` skill and not pasted in. The HTML file goes on the throwaway branch as the evidence; being a single file, it still opens and runs there.

## Do not

- **Add tests.** A prototype that needs tests is no longer a prototype.
- **Connect the real database.** Use in-memory state unless persistence is the question.
- **Generalise.** No "what if we later support X". The prototype answers one question.
- **Mix logic and page.** A module that touches the DOM cannot be lifted out. Keep the page a thin shell over a pure module.
- **Add a framework, bundler or server.** The recipient double-clicks one file; anything heavier defeats sharing it.
- **Ship the HTML shell.** It is built for clicking through by hand. The decision it proved is what moves into real code, rewritten properly.
