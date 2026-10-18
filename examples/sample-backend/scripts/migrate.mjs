#!/usr/bin/env node
// Zero-dependency migration runner for node:sqlite. Migrations are SQL files in migrations/:
// NNNN_name.up.sql (required) and NNNN_name.down.sql (the way back). Applied versions are
// recorded in the schema_migrations table with a checksum of the up file, so a migration that
// was edited after it ran is refused instead of silently drifting from the database.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appRoot, defaultDbFile, openDb } from "../src/db.js";

const USAGE = `usage: node scripts/migrate.mjs <command>
  up            apply every pending migration, in order
  down [N]      roll back the last N applied migrations (default 1)
  status        list migrations and whether each is applied
  new <name>    create the next NNNN_<name>.up.sql and .down.sql pair
the database is DB_FILE (default ${defaultDbFile}, relative to the app root)
exit codes: 0 ok, 1 migration error, 2 usage error`;

export const migrationsDir = path.join(appRoot, "migrations");
const FILE_RE = /^(\d{4})_([a-z0-9_]+)\.(up|down)\.sql$/;

export class MigrationError extends Error {}

export function loadMigrations(dir = migrationsDir) {
	const byVersion = new Map();
	for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
		const m = FILE_RE.exec(file);
		if (!m) {
			if (file.endsWith(".sql")) throw new MigrationError(`bad migration file name: ${file} (expected NNNN_name.up.sql or NNNN_name.down.sql)`);
			continue;
		}
		const [, version, name, kind] = m;
		const entry = byVersion.get(version) ?? { version, name, id: `${version}_${name}`, up: null, down: null };
		if (entry.name !== name) throw new MigrationError(`two migrations share version ${version}: ${entry.id} and ${version}_${name}`);
		entry[kind] = path.join(dir, file);
		byVersion.set(version, entry);
	}
	const list = [...byVersion.values()].sort((a, b) => a.version.localeCompare(b.version));
	for (const m of list) if (!m.up) throw new MigrationError(`${m.id} has a .down.sql but no .up.sql`);
	return list;
}

function checksum(file) {
	// Line endings are normalized so a git checkout with autocrlf does not count as an edit.
	return crypto.createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex");
}

function ensureTable(db) {
	db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)");
}

// One row per migration file plus one per applied version whose files are gone.
// changed: the up file differs from what was applied. missing: applied, but no file any more.
export function status(db, dir = migrationsDir) {
	ensureTable(db);
	const applied = new Map(db.prepare("SELECT version, name, checksum FROM schema_migrations").all().map((r) => [r.version, r]));
	const rows = loadMigrations(dir).map((m) => {
		const row = applied.get(m.version);
		return { ...m, applied: Boolean(row), changed: Boolean(row) && row.checksum !== checksum(m.up), missing: false };
	});
	for (const [version, row] of applied) {
		if (!rows.some((r) => r.version === version)) rows.push({ version, name: row.name, id: `${version}_${row.name}`, up: null, down: null, applied: true, changed: false, missing: true });
	}
	return rows.sort((a, b) => a.version.localeCompare(b.version));
}

function assertUnchanged(rows) {
	const bad = rows.filter((r) => r.changed || r.missing);
	if (!bad.length) return;
	const what = bad.map((r) => `${r.id} (${r.missing ? "applied but its file is gone" : "edited after it was applied"})`).join(", ");
	throw new MigrationError(`applied migrations must not change: ${what}. Restore the original file and add a new migration instead.`);
}

function inTransaction(db, id, fn) {
	db.exec("BEGIN");
	try {
		fn();
		db.exec("COMMIT");
	} catch (err) {
		db.exec("ROLLBACK");
		throw new MigrationError(`${id} failed: ${err.message}`);
	}
}

export function up(db, dir = migrationsDir) {
	const rows = status(db, dir);
	assertUnchanged(rows);
	const done = [];
	for (const m of rows.filter((r) => !r.applied)) {
		inTransaction(db, `${m.id} up`, () => {
			db.exec(fs.readFileSync(m.up, "utf8"));
			db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(m.version, m.name, checksum(m.up), new Date().toISOString());
		});
		done.push(m.id);
	}
	return done;
}

export function down(db, dir = migrationsDir, steps = 1) {
	const rows = status(db, dir);
	assertUnchanged(rows);
	const done = [];
	for (const m of rows.filter((r) => r.applied).reverse().slice(0, steps)) {
		if (!m.down) throw new MigrationError(`${m.id} has no .down.sql, so it cannot be rolled back`);
		inTransaction(db, `${m.id} down`, () => {
			db.exec(fs.readFileSync(m.down, "utf8"));
			db.prepare("DELETE FROM schema_migrations WHERE version = ?").run(m.version);
		});
		done.push(m.id);
	}
	return done;
}

export function create(name, dir = migrationsDir) {
	if (!/^[a-z0-9_]+$/.test(name ?? "")) throw new MigrationError(`migration name must be lower_snake_case, got: ${name ?? "(none)"}`);
	const last = loadMigrations(dir).at(-1);
	const id = `${String(Number(last?.version ?? 0) + 1).padStart(4, "0")}_${name}`;
	fs.mkdirSync(dir, { recursive: true });
	const files = [`${id}.up.sql`, `${id}.down.sql`].map((f) => path.join(dir, f));
	fs.writeFileSync(files[0], `-- ${id}: forward change\n`);
	fs.writeFileSync(files[1], `-- ${id}: undo exactly what ${id}.up.sql does\n`);
	return files;
}

function main(argv) {
	const [cmd, arg] = argv;
	if (cmd === "new") {
		for (const file of create(arg)) console.log(`migrate: created ${path.relative(appRoot, file)}`);
		return 0;
	}
	if (!["up", "down", "status"].includes(cmd)) {
		console.error(USAGE);
		return 2;
	}
	const steps = arg === undefined ? 1 : Number(arg);
	if (cmd === "down" && !(Number.isInteger(steps) && steps > 0)) {
		console.error(USAGE);
		return 2;
	}
	const db = openDb();
	try {
		if (cmd === "up") for (const id of up(db)) console.log(`migrate: applied ${id}`);
		if (cmd === "down") for (const id of down(db, migrationsDir, steps)) console.log(`migrate: rolled back ${id}`);
		const rows = status(db);
		if (cmd === "status") {
			for (const r of rows) console.log(`  [${r.applied ? "x" : " "}] ${r.id}${r.changed ? "  EDITED AFTER APPLY" : ""}${r.missing ? "  FILE MISSING" : ""}${r.applied || r.down ? "" : "  (no down)"}`);
		}
		const applied = rows.filter((r) => r.applied).length;
		console.log(`migrate: ok (${applied} applied, ${rows.length - applied} pending) db=${process.env.DB_FILE ?? defaultDbFile}`);
		return 0;
	} finally {
		db.close();
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch (err) {
		if (!(err instanceof MigrationError)) throw err;
		console.error(`migrate: FAIL ${err.message}`);
		process.exitCode = 1;
	}
}
