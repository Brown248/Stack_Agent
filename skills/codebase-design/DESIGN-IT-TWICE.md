# Design it twice

The first interface that comes to mind is rarely the best. When the user wants alternatives for a module chosen for deepening, produce several designs in parallel and compare them. The terms (module, interface, seam, adapter, leverage, depth, locality) are defined in `SKILL.md` in this folder.

## 1. Frame the problem

Before launching anything, write a short explanation for the user:

- The constraints any new interface must meet.
- The dependencies it would use, each classed by kind (see `DEEPENING.md`).
- A rough code sketch that makes the constraints concrete. It is an illustration, not a proposal.

Show it to the user, and go straight on to section 2. The user reads while the designs are being produced.

## 2. Launch the designers

Launch three or more subagents at once with the `Agent` tool, all in one message so they run in parallel. Each starts with an empty context and sees none of this conversation, so everything it needs must be in its prompt: the file paths, how the code is coupled, the dependency kind, what sits behind the seam, the `SKILL.md` vocabulary, and the project's `GLOSSARY.md` terms if that file exists. Write this technical brief separately from the user-facing text in section 1.

Each designer gets a different constraint, so the designs differ in kind and not in detail:

1. Minimize the interface: one to three entry points at most, most leverage per entry point.
2. Maximize flexibility: support many uses and extension.
3. Optimize for the most common caller: make the default case trivial.
4. When it applies, design around ports and adapters for the dependencies that cross the seam.

Each designer returns:

1. The interface: types, methods, parameters, plus invariants, ordering and error modes.
2. A usage example showing a caller.
3. What the implementation hides behind the seam.
4. The dependency strategy and the adapters (see `DEEPENING.md`).
5. Trade-offs: where leverage is high and where it is thin.

Designers only read and propose. Tell them not to edit files.

## 3. Compare and recommend

Present the designs one at a time so the user can take each in, then compare them in prose on three points: depth (leverage at the interface), locality (where a change would land), and seam placement.

Then give your own recommendation: the design you judge strongest, and why. If parts of different designs fit together, propose that hybrid. Take a position; the user asked for a read, not a menu.

## Done when

- At least three designs came back from subagents that had a fresh context and the same brief apart from their constraint.
- The comparison covers depth, locality and seam placement for every design.
- One design or hybrid is recommended, with the reason.

## Report

The recommended design first, then the comparison, then the trade-off you accepted. Say plainly if a designer failed to answer or if you changed a brief after the first launch.
