---
name: migrate-to-shoehorn
description: "Replace `as` type assertions in tests with shoehorn helpers."
disable-model-invocation: true
---

# Migrate to Shoehorn

## Why shoehorn?

`@total-typescript/shoehorn` lets a test pass partial data while keeping TypeScript satisfied. It replaces `as` assertions with type-checked helpers: `fromPartial`, `fromAny` and `fromExact`.

**Test code only.** Never use shoehorn in production code.

Problems with `as` in tests:

- Many style guides and lint rules discourage `as`, so test files end up with exceptions.
- The target type has to be written out by hand each time.
- Intentionally wrong data needs a double assertion (`as unknown as Type`).

**Check the dependency first.** The package was last released in 2024 and is minimally maintained. Before adding it, ask the user whether the project accepts a small, rarely updated dev dependency, and check that it supports the project's TypeScript version.

## Install

Install it as a dev dependency with the project's package manager (look for `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock` or `bun.lockb`):

```bash
npm i -D @total-typescript/shoehorn
# pnpm add -D @total-typescript/shoehorn
# yarn add -D @total-typescript/shoehorn
# bun add -D @total-typescript/shoehorn
```

## Migration patterns

### Large objects with few needed properties

Before:

```ts
type Request = {
  body: { id: string };
  headers: Record<string, string>;
  cookies: Record<string, string>;
  // ...20 more properties
};

it("gets user by id", () => {
  // Only care about body.id but must fake entire Request
  getUser({
    body: { id: "123" },
    headers: {},
    cookies: {},
    // ...fake all 20 properties
  });
});
```

After:

```ts
import { fromPartial } from "@total-typescript/shoehorn";

it("gets user by id", () => {
  getUser(
    fromPartial({
      body: { id: "123" },
    }),
  );
});
```

### `as Type` → `fromPartial()`

Before:

```ts
getUser({ body: { id: "123" } } as Request);
```

After:

```ts
import { fromPartial } from "@total-typescript/shoehorn";

getUser(fromPartial({ body: { id: "123" } }));
```

### `as unknown as Type` → `fromAny()`

Before:

```ts
getUser({ body: { id: 123 } } as unknown as Request); // wrong type on purpose
```

After:

```ts
import { fromAny } from "@total-typescript/shoehorn";

getUser(fromAny({ body: { id: 123 } }));
```

## When to use each

| Function        | Use case                                           |
| --------------- | -------------------------------------------------- |
| `fromPartial()` | Pass partial data that still type-checks           |
| `fromAny()`     | Pass intentionally wrong data (keeps autocomplete) |
| `fromExact()`   | Force full object (swap with fromPartial later)    |

## Workflow

1. **Gather requirements.** Ask the user:
   - Which test files have `as` assertions causing problems?
   - Are they dealing with large objects where only some properties matter?
   - Do they need to pass intentionally wrong data for error testing?

2. **Install and migrate:**
   - [ ] Install the package as a dev dependency (see Install).
   - [ ] Find test files with `as` assertions. The test file globs are `*.test.{ts,tsx,mts}` and `*.spec.{ts,tsx,mts}`. In a git repository:
     `git grep -nE " as (unknown as )?[A-Z]" -- "*.test.ts" "*.test.tsx" "*.test.mts" "*.spec.ts" "*.spec.tsx" "*.spec.mts"`
     In PowerShell without git:
     `Get-ChildItem -Recurse -Include *.test.ts,*.test.tsx,*.test.mts,*.spec.ts,*.spec.tsx,*.spec.mts | Select-String -Pattern " as (unknown as )?[A-Z]"`
     Skip `node_modules`. Also skip `as const` and imports renamed with `as` (`import { a as b }`), which are not type assertions.
   - [ ] Replace `as Type` with `fromPartial()`.
   - [ ] Replace `as unknown as Type` with `fromAny()`.
   - [ ] Add imports from `@total-typescript/shoehorn`.
   - [ ] Run the type check (the project's `typecheck` script, or `tsc --noEmit` from the project's own TypeScript) and then the tests.
   - [ ] In a project with `.stack-agent/verify.json`, run `node .stack-agent/bin/verify.mjs` before calling the work done.

## Done when

- No migrated file still has the `as` assertion it was asked to replace, and no production file imports shoehorn.
- The type check and the tests were run after the change, and their results were read.
- Nothing was committed unless the user asked.

## Report

Say how many files and assertions were changed, which were left alone and why (for example a cast that is not a test fixture), and the result of the type check and the tests. Say plainly anything not run.
