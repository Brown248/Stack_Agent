# The out-of-scope folder

`.out-of-scope/` at the repository root holds one short file for each kind of request the project has decided not to build. It does two jobs:

1. It keeps the reasoning after the issue is closed, so nobody has to dig it out of old threads.
2. It lets triage recognise a repeat request and show the earlier decision instead of arguing it again.

## 1. Layout

```
.out-of-scope/
  dark-mode.md
  plugin-system.md
  graphql-api.md
```

One file per concept, not per issue. Several issues asking for the same thing share one file. Name the file with a short kebab-case phrase that tells a reader what was refused without opening it.

## 2. File format

Write it like a short design note that someone meeting the question for the first time can follow. Use paragraphs, and add a code sample when it makes the reason clearer.

```markdown
# Dark Mode

This project does not support dark mode or user-facing theming.

## Why this is out of scope

The rendering code assumes one color palette, fixed in `ThemeConfig` when the
project is built. Supporting several themes would need:

- a theme provider around the whole component tree
- theme-aware style lookup in every component
- storage for each user's theme choice

That is a large change to the architecture, and it does not fit the project's
focus on content authoring. Theming belongs to the projects that embed the
output.

```ts
// ThemeConfig is not built for switching at run time:
interface ThemeConfig {
  colors: ColorPalette; // one palette, fixed at build time
  fonts: FontStack;
}
```

## Prior requests

- #42: "Add dark mode support"
- #87: "Night theme for accessibility"
- #134: "Dark theme option"
```

### The reason must be a real reason

"We do not want this" is not a reason. Give one or more of:

- Scope: what the project is for, and why this falls outside it.
- A technical constraint: what the feature would need, and which design it conflicts with.
- A decision already made: what was chosen instead, and why.

The reason must still hold next year. "We are busy right now" is a postponement, not a rejection; do not record it here. Leave that item open or label it for later.

## 3. When to read the folder

Read every file in it while gathering context for each item. Compare by meaning, not by keyword: a request for a "night theme" matches `dark-mode.md`. When one matches, show the maintainer the file and the reason, and ask whether they still agree.

The maintainer has three answers:

- **Still agree.** Add the new item to the file's "Prior requests" list and close the item.
- **Changed their mind.** Delete or rewrite the file, and triage the item as usual.
- **Related but different.** Triage the item as usual and leave the file alone.

## 4. When to write to it

Write only when an enhancement is rejected as `wontfix`. That includes an enhancement pull request: record the rejection, so the same request does not come back as new code.

Do not write for a bug. Do not write when the item is closed because the feature already exists. A built feature is not a rejected one, and a file saying it was rejected would give false matches on later requests. In that case the closing comment points to where the feature lives.

Procedure once the maintainer has decided:

1. Look for an existing file on the same concept.
2. If there is one, add the item to its "Prior requests".
3. If not, create a file with the concept name, the decision, the reason, and this item as the first prior request.
4. Post a comment on the item that explains the decision and mentions the file. It starts with the disclaimer line from `SKILL.md`.
5. Set the `wontfix` state and close the item.

Show the maintainer the file text before writing it. The maintainer's confirmation rule in `SKILL.md` applies to this file too.

## 5. Changing or removing a file

If the maintainer reverses an earlier decision, delete the file. Old closed issues stay closed; they are history, and nothing here reopens them. The item that prompted the change goes through normal triage.
