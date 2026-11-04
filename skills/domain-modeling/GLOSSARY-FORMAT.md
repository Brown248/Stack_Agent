# GLOSSARY.md format

## Layout

```md
# {Context name}

{One or two sentences: what this context is and why it exists.}

## Language

**Order**:
A customer's request to buy one or more products, from placing to delivery.
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request

**Customer**:
A person or organization that places orders.
_Avoid_: Client, buyer, account
```

## Rules

- **Pick one.** When several words name the same concept, choose the best, define it, and list the rest on its `_Avoid_` line. A glossary that lists the names without choosing has settled nothing.
- **Keep definitions short.** One or two sentences, saying what the thing is, not what it does or how it is built.
- **Project terms only.** Generic programming words (timeouts, error types, helper patterns) do not belong, even if the project uses them everywhere. Ask of each candidate: is this a concept unique to this context? If not, leave it out.
- **Group when groups appear.** Use subheadings once natural clusters form. A single flat list is fine for a small context.
- **No implementation detail.** No field names, tables, or file paths. The glossary is not a spec or a scratch pad.

## One context or several

**One context (most repos).** A single `GLOSSARY.md` at the repo root.

**Several contexts.** A `GLOSSARY-MAP.md` at the root lists each context, where it lives, and how contexts relate:

```md
# Glossary Map

## Contexts

- [Ordering](./src/ordering/GLOSSARY.md): receives and tracks customer orders
- [Billing](./src/billing/GLOSSARY.md): generates invoices and processes payments
- [Fulfillment](./src/fulfillment/GLOSSARY.md): manages warehouse picking and shipping

## Relationships

- **Ordering → Fulfillment**: Ordering emits `OrderPlaced` events; Fulfillment consumes them to start picking
- **Fulfillment → Billing**: Fulfillment emits `ShipmentDispatched` events; Billing consumes them to generate invoices
- **Ordering ↔ Billing**: shared types for `CustomerId` and `Money`
```

## Which layout applies

- `GLOSSARY-MAP.md` exists: read it to find the contexts.
- Only a root `GLOSSARY.md` exists: one context.
- Neither exists: create a root `GLOSSARY.md` when the first term is settled.

With several contexts, work out which one the topic belongs to. If that is unclear, ask.
