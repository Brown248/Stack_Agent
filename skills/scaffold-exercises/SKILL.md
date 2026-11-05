---
name: scaffold-exercises
description: "Create exercise folders (sections, problems, solutions, explainers) for course-style repos."
disable-model-invocation: true
---

# Scaffold Exercises

Create exercise directory structures for a repository laid out for course tooling: an `exercises/` folder of numbered sections, each holding numbered exercises with `problem/`, `solution/` and `explainer/` subfolders.

**Scope.** The layout and the lint rules below belong to one course toolchain, and the validator, `pnpm ai-hero-cli internal lint`, is an optional tool that may not be installed in the repository. If `exercises/` does not exist, or `package.json` does not mention `ai-hero-cli`, ask the user whether this layout is really what they want before creating anything. If the validator is missing, check the rules in "Lint rules summary" by hand instead and say so in the report.

Do not commit unless the user asked. If they did, commit on a feature branch only, never on the default branch, and never push.

## Directory naming

- **Sections**: `XX-section-name/` inside `exercises/` (e.g., `01-retrieval-skill-building`)
- **Exercises**: `XX.YY-exercise-name/` inside a section (e.g., `01.03-retrieval-with-bm25`)
- Section number = `XX`, exercise number = `XX.YY`
- Names are dash-case (lowercase, hyphens)

## Exercise variants

Each exercise needs at least one of these subfolders:

- `problem/` - student workspace with TODOs
- `solution/` - reference implementation
- `explainer/` - conceptual material, no TODOs

When stubbing, default to `explainer/` unless the plan specifies otherwise.

## Required files

Each subfolder (`problem/`, `solution/`, `explainer/`) needs a `readme.md` that:

- Is **not empty** (must have real content, even a single title line works)
- Has no broken links

When stubbing, create a minimal readme with a title and a description:

```md
# Exercise Title

Description here
```

If the subfolder has code, it also needs a `main.ts` (>1 line). But for stubs, a readme-only exercise is fine.

## Workflow

1. **Parse the plan** - extract section names, exercise names, and variant types
2. **Create directories** - one folder per path (`mkdir -p` in bash, `New-Item -ItemType Directory -Force` in PowerShell; see the example)
3. **Create stub readmes** - one `readme.md` per variant folder with a title
4. **Run lint** - `pnpm ai-hero-cli internal lint` to validate, when the CLI is installed; otherwise check the rules below by hand
5. **Fix any errors** - iterate until lint passes, and read the output each time

## Lint rules summary

The linter (`pnpm ai-hero-cli internal lint`) checks the following. These rules come from one tool version, so if the tool reports something different, the tool wins:

- Each exercise has subfolders (`problem/`, `solution/`, `explainer/`)
- At least one of `problem/`, `explainer/`, or `explainer.1/` exists
- `readme.md` exists and is non-empty in the primary subfolder
- No `.gitkeep` files
- No `speaker-notes.md` files
- No broken links in readmes
- No `pnpm run exercise` commands in readmes
- `main.ts` required per subfolder unless it's readme-only

## Moving/renaming exercises

When renumbering or moving exercises:

1. Use `git mv` (not `mv`) to rename directories - preserves git history
2. Update the numeric prefix to maintain order
3. Re-run lint after moves

Example:

```bash
git mv exercises/01-retrieval/01.03-embeddings exercises/01-retrieval/01.04-embeddings
```

## Example: stubbing from a plan

Given a plan like:

```
Section 05: Memory Skill Building
- 05.01 Introduction to Memory
- 05.02 Short-term Memory (explainer + problem + solution)
- 05.03 Long-term Memory
```

Create the folders. In bash (brace expansion works only in bash, not in PowerShell or cmd):

```bash
mkdir -p exercises/05-memory-skill-building/05.01-introduction-to-memory/explainer
mkdir -p exercises/05-memory-skill-building/05.02-short-term-memory/{explainer,problem,solution}
mkdir -p exercises/05-memory-skill-building/05.03-long-term-memory/explainer
```

In PowerShell, list the paths instead:

```powershell
$base = "exercises/05-memory-skill-building"
New-Item -ItemType Directory -Force -Path @(
  "$base/05.01-introduction-to-memory/explainer",
  "$base/05.02-short-term-memory/explainer",
  "$base/05.02-short-term-memory/problem",
  "$base/05.02-short-term-memory/solution",
  "$base/05.03-long-term-memory/explainer"
) | Out-Null
```

Then create readme stubs (in PowerShell, `Set-Content -Path <file> -Value "# Title" -Encoding utf8`; in bash, `echo '# Title' > <file>`):

```
exercises/05-memory-skill-building/05.01-introduction-to-memory/explainer/readme.md -> "# Introduction to Memory"
exercises/05-memory-skill-building/05.02-short-term-memory/explainer/readme.md -> "# Short-term Memory"
exercises/05-memory-skill-building/05.02-short-term-memory/problem/readme.md -> "# Short-term Memory"
exercises/05-memory-skill-building/05.02-short-term-memory/solution/readme.md -> "# Short-term Memory"
exercises/05-memory-skill-building/05.03-long-term-memory/explainer/readme.md -> "# Long-term Memory"
```

## Done when

- Every exercise folder has at least one variant subfolder, and each subfolder has a non-empty `readme.md`.
- The validator ran and passed, or, if it is not installed, each rule in "Lint rules summary" was checked by hand and the report says so.
- Renamed folders were moved with `git mv`.
- Nothing was committed unless the user asked.

## Report

Say which sections and exercises were created, the validator result (or that it was not available and the rules were checked by hand), and anything not checked, such as broken links in readmes.
