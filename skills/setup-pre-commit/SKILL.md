---
name: setup-pre-commit
description: "Add Husky pre-commit hooks with lint-staged, type checking and tests."
disable-model-invocation: true
---

# Setup Pre-Commit Hooks

## What This Sets Up

- **Husky** pre-commit hook
- **lint-staged** running Prettier on all staged files
- **Prettier** config (if missing)
- **typecheck** and **test** scripts in the pre-commit hook

**In a Stack Agent project:** `npx husky init` sets `core.hooksPath`, which Stack Agent's hooks deny when the agent runs it on its own, so run these steps only with the user's yes. Put `.stack-agent/` in `.prettierignore` and leave it out of lint-staged: the tools in `.stack-agent/bin/` must stay byte for byte, or `init` reports them as outdated. Do not commit unless the user asked.

## Steps

### 1. Detect package manager

Check for `package-lock.json` (npm), `pnpm-lock.yaml` (pnpm), `yarn.lock` (yarn), and `bun.lock` or `bun.lockb` (bun; `bun.lock` is the text lockfile Bun has written by default since 1.2, `bun.lockb` is the older binary one). Use whichever is present. Default to npm if unclear or if several are present, and tell the user which one was picked.

### 2. Install dependencies

Install these three packages as devDependencies with the detected manager:

```
husky lint-staged prettier
```

For example `npm i -D husky lint-staged prettier`, `pnpm add -D ...`, `yarn add -D ...`, or `bun add -D ...`. If the repo already has one of them, keep its version.

### 3. Initialize Husky

```bash
npx husky init
```

With pnpm run `pnpm exec husky init`, with bun run `bunx husky init`. This creates the `.husky/` folder and adds `"prepare": "husky"` to package.json.

### 4. Create `.husky/pre-commit`

Write this file (Husky 9 and later needs no shebang). `husky init` also writes a sample command into it; replace that:

```
npx lint-staged
npm run typecheck
npm run test
```

**Adapt**: Replace `npm` with the detected package manager (`pnpm exec lint-staged` and `pnpm run typecheck`, `bunx lint-staged` and `bun run typecheck`, and so on). If the repo has no `typecheck` or `test` script in package.json, omit those lines and tell the user.

### 5. Create `.lintstagedrc`

First check whether lint-staged config already exists: `.lintstagedrc`, `.lintstagedrc.json`, `.lintstagedrc.yaml`, `.lintstagedrc.mjs`, `.lintstagedrc.cjs`, `.lintstagedrc.js`, `lint-staged.config.*`, or a `lint-staged` key in package.json. If one exists, add the Prettier command to it and do not create a second file. Otherwise create:

```json
{
  "*": "prettier --ignore-unknown --write"
}
```

### 6. Create `.prettierrc` (if missing)

Only create if no Prettier config exists (`.prettierrc*`, `prettier.config.*`, or a `prettier` key in package.json). Use these defaults (they match Prettier 3; `"all"` is its default trailing comma):

```json
{
  "useTabs": false,
  "tabWidth": 2,
  "printWidth": 80,
  "singleQuote": false,
  "trailingComma": "all",
  "semi": true,
  "arrowParens": "always"
}
```

### 7. Verify

- [ ] `.husky/pre-commit` exists (on macOS and Linux it should also be executable; Windows has no executable bit)
- [ ] A lint-staged config exists (one of the names in step 5)
- [ ] `prepare` script in package.json is `"husky"`
- [ ] A Prettier config exists
- [ ] Run `npx lint-staged` (or the detected manager's form) and read the output. It must run Prettier without an error. With nothing staged it prints that no staged files matched, which is fine.

Report any check that failed. Do not say the hooks work until `lint-staged` has run.

### 8. Commit only if asked

Do not commit unless the user asked. If they did, commit on a feature branch, never on the default branch, and never push. Suggested message: `Add pre-commit hooks (husky + lint-staged + prettier)`. The commit runs through the new hook, which is a good smoke test of the whole chain.

If the user did not ask, list the files that were created or changed and stop.

## Notes

- Husky 9 and later needs no shebang in hook files.
- `prettier --ignore-unknown` skips files Prettier cannot parse (images and the like).
- The hook runs lint-staged first (fast, staged files only), then the full typecheck and tests. A slow test suite makes every commit slow; tell the user if the suite takes long.
- On Windows the hook runs through the shell that Git for Windows ships, so write hook lines in plain `sh` syntax.

## Done when

- The three packages are in devDependencies, `.husky/pre-commit` has the lines that match the repo's scripts, and `prepare` is `"husky"`.
- `npx lint-staged` (or the manager's form) ran and its output was read.
- In a Stack Agent project, `.stack-agent/` is in `.prettierignore` and not in lint-staged's globs.
- No commit was made unless the user asked.

## Report

Say what was installed and which package manager was used, which files were created or edited, which of `typecheck` and `test` were left out because the repo has no such script, and the result of the `lint-staged` run. Say plainly anything not run (for example "did not make a test commit").
