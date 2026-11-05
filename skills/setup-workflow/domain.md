# Domain docs

Layout: `single-context`

How skills read this repo's domain documentation before they explore the code.

## Read these first

- **`GLOSSARY.md`** at the repo root, or
- **`GLOSSARY-MAP.md`** at the repo root, if it exists. It points at one `GLOSSARY.md` per context; read each one that is relevant to the topic.
- **`docs/adr/`**: read the decision records that touch the area you are about to change. In a multi-context repo also check `src/<context>/docs/adr/` for decisions scoped to one context.

If one of these files does not exist, carry on without comment. Do not point out that it is missing and do not offer to create it. The `domain-modeling` skill creates them when a term or decision is actually settled; `grilling` and `improve-codebase-architecture` start it.

## File layout

Single-context repo (almost every repo):

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (a `GLOSSARY-MAP.md` exists at the root):

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          <- decisions that apply everywhere
└── src/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── docs/adr/                  <- decisions for this context only
    └── billing/
        ├── GLOSSARY.md
        └── docs/adr/
```

## Use the glossary's words

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test name), use the term as `GLOSSARY.md` defines it. Do not slip into a synonym the glossary lists under words to avoid.

If the concept you need is not in the glossary, that is a signal. Either you are inventing language the project does not use (reconsider), or there is a real gap (note it for `domain-modeling`).

## Flag conflicts with decisions

If your output contradicts an existing ADR, say so instead of quietly overriding it:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because..._
