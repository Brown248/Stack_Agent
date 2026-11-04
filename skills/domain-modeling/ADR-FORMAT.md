# ADR format

An ADR (architecture decision record) is a short file that says what was decided and why. ADRs live in `docs/adr/` and are numbered in order: `0001-slug.md`, `0002-slug.md`.

Create `docs/adr/` only when the first ADR is needed.

## Template

```md
# {Short title of the decision}

{One to three sentences: the context, what was decided, and why.}
```

That is a complete ADR. A single paragraph is fine. The value is that the decision and its reason are written down, not that every heading is filled.

## Optional parts

Add one only when it carries information a reader would otherwise lack.

- **Status** at the top (`proposed`, `accepted`, `deprecated`, or `superseded by ADR-NNNN`): when decisions get revisited.
- **Considered options**: when the rejected alternatives are worth remembering.
- **Consequences**: when a downstream effect is not obvious.

## Numbering

List the folder and take the highest number plus one.

```bash
ls docs/adr
```

```powershell
Get-ChildItem docs/adr -Name
```

Never reuse or renumber an existing ADR. To change a decision, write a new ADR and mark the old one `superseded by ADR-NNNN`.

## When to write one

All three must hold:

1. **Hard to reverse.** Changing your mind later costs real effort.
2. **Surprising without context.** A reader of the code will wonder why it was done this way.
3. **A real trade-off.** There were genuine alternatives and one was picked for specific reasons.

If a decision is easy to undo, it will simply be undone. If it is not surprising, nobody will ask why. If there was no alternative, there is nothing to record beyond "we did the obvious thing".

## What usually qualifies

- **Architectural shape.** A monorepo; a write model that is event-sourced with a read model projected into Postgres.
- **How contexts talk to each other.** Ordering and Billing exchange domain events, not synchronous HTTP calls.
- **Technology with lock-in.** Database, message bus, auth provider, deployment target. Not every library, only the ones that would take a quarter to swap.
- **Boundary and scope rules.** Customer data is owned by the Customer context and referenced elsewhere by ID only. Written-down "no" decisions are as useful as "yes" ones.
- **Deliberate departures from the obvious path.** Hand-written SQL instead of an ORM, for a stated reason. Without a record, the next engineer "fixes" it.
- **Constraints the code cannot show.** A compliance rule that rules out a cloud provider; a partner contract that caps response time at 200 ms.
- **Rejected alternatives that will be proposed again.** If GraphQL was considered and REST chosen for subtle reasons, write that down before someone suggests GraphQL in six months.

## What does not qualify

Naming choices (those go in `GLOSSARY.md`), library picks that are easy to swap, bug fixes, and anything that is a plan rather than a decision already made.
