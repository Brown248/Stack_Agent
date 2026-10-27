import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const defaultDbFile = "data/app.db";

let current;

// Opens a SQLite database. Relative paths resolve against the app root; ":memory:" is a
// throwaway database (the tests use it).
export function openDb(file = process.env.DB_FILE ?? defaultDbFile) {
	if (file === ":memory:") return new DatabaseSync(file);
	const abs = path.resolve(appRoot, file);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	return new DatabaseSync(abs);
}

export function connect(file) {
	current?.close();
	current = openDb(file);
	return current;
}

export function db() {
	return current ?? connect();
}

// Empties every table except the migration bookkeeping, so tests start from a migrated, empty schema.
export function reset() {
	const tables = db().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'").all();
	for (const { name } of tables) db().exec(`DELETE FROM "${name}"`);
}
