---
name: codebase-design
description: Use when designing or reshaping a module's interface, deciding where a seam goes, or turning thin pass-through code into deep modules, or when another skill needs the shared module, interface, seam and depth vocabulary. Triggers: "design the interface", "where should the seam go", "deep module", "shallow module", "deepen this", "make this easier to test", "ออกแบบ interface", "ควรแบ่งโมดูลตรงไหน", "ทำให้เทสต์ง่ายขึ้น".
---

# Design deep modules

The target is a **deep module**: a lot of behavior behind a small interface, placed at a clean seam, tested through that interface. Callers gain leverage, maintainers gain locality, and tests get one stable surface. The failure mode is vague design talk: "component", "service", "boundary" and "API" each mean five things, so two people agree on a diagram and build different code. Fix it by using the words in section 1 and nothing else.

## 1. Vocabulary

Use these terms exactly. Do not swap in the words listed as avoid.

- **Module.** Anything that has an interface and an implementation, at any size: a function, a class, a package, or a slice through several tiers. Avoid: unit, component, service.
- **Interface.** Everything a caller must know to use the module correctly. The types are only part of it; add the invariants, the required call order, the error behavior, the configuration it needs, and its speed and cost. Avoid: API, signature (both cover only the type-level surface).
- **Implementation.** The code inside the module, behind the interface.
- **Depth.** How much behavior a caller or a test can use per unit of interface they must learn. A module is **deep** when much behavior sits behind a small interface and **shallow** when its interface is nearly as complicated as its implementation.
- **Seam.** The place where a module's interface lives: the public boundary where callers and tests meet the module, and where behavior can be swapped without editing the module. Where the seam goes is its own decision, separate from what goes behind it. Avoid: boundary (it already means "bounded context" in domain modeling).
- **Adapter.** A concrete thing that fills the interface at a seam. The word names a role (which slot it fills), not what is inside. A small adapter can wrap a large implementation (a database-backed repository), and a large adapter can have a tiny implementation (an in-memory fake). Say "adapter" when the seam is the topic and "implementation" otherwise.
- **Leverage.** What callers get from depth: more capability per unit of interface learned. One implementation pays off across many call sites and many tests.
- **Locality.** What maintainers get from depth: changes, bugs, knowledge and checks collect in one place instead of spreading over every caller. Fix it once and it is fixed for all.

How they fit: a module has one interface. Depth is measured between a module and its interface. A seam is where that interface lives, and an adapter sits at a seam and satisfies it. Depth gives callers leverage and maintainers locality.

`skills/tdd` uses the same word. Its seam is the boundary a test is written at; here it is also where behavior can be swapped. These are one idea: the interface where callers and tests meet the module. If you change one definition, change the other.

## 2. Deep versus shallow

```
Deep module                        Shallow module (avoid)
+-----------------------+          +-------------------------------+
| small interface       |          | large interface               |
+-----------------------+          +-------------------------------+
|                       |          | thin implementation           |
| lots of behavior      |          | (mostly passes calls through) |
| hidden here           |          +-------------------------------+
|                       |
+-----------------------+
```

While shaping an interface, ask each time:

- Can it have fewer methods?
- Can the parameters be simpler?
- Can more of the complexity move inside?

## 3. Rules

1. **Depth belongs to the interface, not the implementation.** A deep module may be built from small, swappable, mockable parts as long as they are not part of its interface. It can have internal seams (private, used by its own tests) as well as the external seam at its interface. Do not measure depth as lines of implementation over lines of interface; that rewards padding.
2. **Run the deletion test.** Imagine deleting the module. If its complexity disappears, it was a pass-through, so merge or remove it. If the complexity reappears in many callers, it was earning its place. Back the verdict with evidence: list the call sites with Grep and name how many would absorb the logic.
3. **The interface is the test surface.** Callers and tests cross the same seam. If a test must reach past the interface to check anything, the module has the wrong shape.
4. **One adapter is a hypothetical seam; two adapters make a real one.** Do not add a seam unless something actually varies across it. A seam with a single adapter is indirection.

## 4. Design for testability

1. **Take dependencies in; do not create them inside.**

   ```typescript
   // testable: the gateway arrives from outside
   function processOrder(order, paymentGateway) {}

   // hard to test: the module builds its own collaborator
   function processOrder(order) {
     const gateway = new PaymentGateway();
   }
   ```

2. **Return results instead of mutating.**

   ```typescript
   // testable: input in, value out
   function calculateDiscount(cart): Discount {}

   // hard to test: the effect hides in the argument
   function applyDiscount(cart): void {
     cart.total -= discount;
   }
   ```

3. **Keep the surface small.** Fewer methods need fewer tests, and fewer parameters make a simpler setup.

## 5. Where to go next

- Choosing where a seam goes for a cluster of shallow modules, by looking at what each depends on: read `DEEPENING.md` in this folder. It covers the four dependency kinds, the two-adapter rule, and replacing tests instead of stacking them.
- Comparing several radically different interfaces for one chosen module: read `DESIGN-IT-TWICE.md` in this folder. It runs three or more parallel designs, then compares them on depth, locality and seam placement.
- Domain words: if `GLOSSARY.md` exists, name modules and interface members with its terms, and read the ADRs in `docs/adr/` that touch the area before proposing a change.

A seam decision worth keeping can become a guard rule that fails the build when a layer is crossed. Say so to the user and point them at `/stack-agent:correct`, which adds an import rule to `.stack-agent/guard.config.json`. That skill is typed-only, so do not start it yourself.

## Done when

- Every module you discuss is named with the vocabulary above, with no component, service, API or boundary left over.
- Each claim that a module is shallow, deep or pointless cites the deletion test result and the call sites you counted.
- Each proposed seam says what varies across it and names at least two adapters (usually production and test), or is dropped.
- In a project with `.stack-agent/verify.json`, if you went on to change code, `node .stack-agent/bin/verify.mjs` has passed.

## Report

Give the module or cluster, the design you recommend, and why, in that order. State the seam and its adapters, and the evidence (call sites counted, tests that would move to the new interface). Say plainly what you did not run or check.
