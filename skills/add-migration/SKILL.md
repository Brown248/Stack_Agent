---
name: add-migration
description: For projects with a database. Use when the schema changes: a new migration, column, table, or index. Use for "add a migration", "ทำ migration", "add a column", "change the schema".
---

# Add a migration

This skill is generic. It needs the repo's own migration commands. Look for them in `package.json` scripts, a `Makefile`, the ORM config (Prisma, TypeORM, Knex, Sequelize, Alembic, Flyway, golang-migrate), or the README. If you cannot find a way to run migrations against a local database, stop and ask the user. Do not write a migration you cannot run.

Reference setup: the Stack Agent sample backend (`examples/sample-backend`) uses `node scripts/migrate.mjs up | down [N] | status | new <name> | redo [N]` on `node:sqlite`. Migrations are `migrations/NNNN_name.up.sql` plus `.down.sql`, the database is `DB_FILE` (default `data/app.db`, gitignored), and the tests migrate an in-memory database. Other repos have their own equivalents. Find them; do not copy these.

## Rules

- Never edit or delete a migration that has been merged or deployed. Add a new one that changes it forward. If the runner records checksums (the sample's does, in `schema_migrations`), an edited applied migration fails `up` and `status` shows `EDITED AFTER APPLY`. Restore the file. Do not reset the database to get past it.
- Every migration has a working down path, or the reply says plainly why it cannot (for example, a dropped column's data cannot come back).
- Split a risky change (rename, type change, NOT NULL on a large table) into expand, backfill, and contract steps, each its own migration, so old and new code can run at the same time. A new column on existing rows needs a default or must be nullable.
- Data access for the new columns goes in the repository layer, like everything else (see `.stack-agent/rules.md`).

## Steps

1. Generate the migration with the repo's own generator command so the file name and ordering follow the convention (sample: `node scripts/migrate.mjs new add_price`).
2. Write the up and down parts.
3. Against a local or disposable database only, run: up, then down, then up again. All three must succeed. Check the schema after each step (sample: `status`, or `PRAGMA table_info(<table>)` for SQLite). Paste the commands and their last lines in your reply. Prefer the runner's own round-trip command when it has one (Rails `db:migrate:redo`, the sample's `node scripts/migrate.mjs redo`, which runs all three on an in-memory database, prints the schema after each, and fails when it does not come back the same). Otherwise point the database at a scratch file (sample: `DB_FILE=data/scratch.db node scripts/migrate.mjs up`). If no file can be written (a read-only sandbox), use an in-memory or throwaway database rather than skipping the step; skip it only when neither works, and say so.
4. Update the code that reads and writes the changed tables, and its tests. Run the test suite and the verify skill (`node .stack-agent/bin/verify.mjs`). Both must pass with the new schema. Verify must start the server on a database migrated by the repo's runner (the sample's `verify.json` runs `migrate.mjs up` before the server, and the server refuses to start with pending migrations).
5. Run `node .stack-agent/bin/guard.mjs`. It must print `guard: ok`.

## Report

The migration file, what it changes, the up/down/up output, the verify evidence path, and any step that is not reversible with the reason. Never run a migration against a shared or production database. That needs a human.
