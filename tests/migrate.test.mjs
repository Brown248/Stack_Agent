import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { copySample, sampleDir, tempDir, write } from "./helpers.mjs";

const { openDb } = await import(pathToFileURL(path.join(sampleDir, "src/db.js")));
const { MigrationError, create, down, loadMigrations, redo, status, up } = await import(pathToFileURL(path.join(sampleDir, "scripts/migrate.mjs")));

function migrationsDir(files) {
	const dir = tempDir("stack-agent-migrations-");
	for (const [name, sql] of Object.entries(files)) write(dir, name, sql);
	return dir;
}

const twoSteps = {
	"0001_create_items.up.sql": "CREATE TABLE items (\n\tid INTEGER PRIMARY KEY,\n\tname TEXT NOT NULL\n);\n",
	"0001_create_items.down.sql": "DROP TABLE items;",
	"0002_add_price.up.sql": "ALTER TABLE items ADD COLUMN price INTEGER NOT NULL DEFAULT 0;",
	"0002_add_price.down.sql": "ALTER TABLE items DROP COLUMN price;",
};

function columns(db, table) {
	return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

function runMigrate(dir, args, dbFile) {
	const r = spawnSync(process.execPath, [path.join(dir, "scripts/migrate.mjs"), ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, DB_FILE: dbFile } });
	return { code: r.status, out: r.stdout + r.stderr };
}

test("up applies pending migrations in order and records them", () => {
	const db = openDb(":memory:");
	const dir = migrationsDir(twoSteps);
	assert.deepEqual(up(db, dir), ["0001_create_items", "0002_add_price"]);
	assert.deepEqual(columns(db, "items"), ["id", "name", "price"]);
	assert.deepEqual(up(db, dir), [], "a second up has nothing to do");
	assert.ok(status(db, dir).every((m) => m.applied && !m.changed));
});

test("up, down, up round-trips the schema", () => {
	const db = openDb(":memory:");
	const dir = migrationsDir(twoSteps);
	up(db, dir);
	assert.deepEqual(down(db, dir), ["0002_add_price"]);
	assert.deepEqual(columns(db, "items"), ["id", "name"]);
	assert.deepEqual(status(db, dir).map((m) => m.applied), [true, false]);
	assert.deepEqual(up(db, dir), ["0002_add_price"]);
	assert.deepEqual(columns(db, "items"), ["id", "name", "price"]);
	assert.deepEqual(down(db, dir, 2), ["0002_add_price", "0001_create_items"]);
	assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'items'").get(), undefined);
});

test("a failing migration rolls back and is not recorded", () => {
	const db = openDb(":memory:");
	const dir = migrationsDir({
		"0001_create_items.up.sql": "CREATE TABLE items (id INTEGER PRIMARY KEY);",
		"0002_broken.up.sql": "CREATE TABLE half (id INTEGER); ALTER TABLE nope ADD COLUMN x INTEGER;",
	});
	assert.throws(() => up(db, dir), (err) => err instanceof MigrationError && /0002_broken up failed/.test(err.message));
	assert.deepEqual(status(db, dir).map((m) => m.applied), [true, false]);
	assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'half'").get(), undefined, "the partial table is rolled back");
});

test("editing an applied migration is refused, and CRLF checkouts do not count as edits", () => {
	const db = openDb(":memory:");
	const dir = migrationsDir(twoSteps);
	up(db, dir);
	const file = path.join(dir, "0001_create_items.up.sql");
	fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
	assert.equal(status(db, dir)[0].changed, false);
	fs.writeFileSync(file, "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER);");
	write(dir, "0003_more.up.sql", "SELECT 1;");
	assert.equal(status(db, dir)[0].changed, true);
	assert.throws(() => up(db, dir), /0001_create_items \(edited after it was applied\)/);
	assert.throws(() => down(db, dir), /edited after it was applied/);
});

test("an applied migration whose file was deleted is refused", () => {
	const db = openDb(":memory:");
	const dir = migrationsDir(twoSteps);
	up(db, dir);
	fs.rmSync(path.join(dir, "0002_add_price.up.sql"));
	fs.rmSync(path.join(dir, "0002_add_price.down.sql"));
	assert.equal(status(db, dir).at(-1).missing, true);
	assert.throws(() => up(db, dir), /0002_add_price \(applied but its file is gone\)/);
});

test("down refuses a migration with no down file", () => {
	const db = openDb(":memory:");
	const dir = migrationsDir({ "0001_create_items.up.sql": "CREATE TABLE items (id INTEGER PRIMARY KEY);" });
	up(db, dir);
	assert.throws(() => down(db, dir), /0001_create_items has no \.down\.sql/);
	assert.equal(status(db, dir)[0].applied, true);
});

test("bad file names and duplicate versions are rejected", () => {
	assert.throws(() => loadMigrations(migrationsDir({ "1_items.sql": "" })), /bad migration file name: 1_items\.sql/);
	assert.throws(() => loadMigrations(migrationsDir({ "0001_a.up.sql": "", "0001_b.up.sql": "" })), /two migrations share version 0001/);
	assert.throws(() => loadMigrations(migrationsDir({ "0001_a.down.sql": "" })), /0001_a has a \.down\.sql but no \.up\.sql/);
});

test("create numbers the next migration and writes both files", () => {
	const dir = migrationsDir(twoSteps);
	const files = create("add_tags", dir).map((f) => path.basename(f));
	assert.deepEqual(files, ["0003_add_tags.up.sql", "0003_add_tags.down.sql"]);
	assert.equal(loadMigrations(dir).at(-1).id, "0003_add_tags");
	assert.throws(() => create("Add Tags", dir), /lower_snake_case/);
});

test("the CLI runs up, down, up and status on a file database in the sample", () => {
	const dir = copySample();
	const dbFile = "data/cli.db";
	assert.match(runMigrate(dir, ["status"], dbFile).out, /\[ \] 0001_create_items[\s\S]*0 applied, 1 pending/);
	for (const [args, line] of [[["up"], /applied 0001_create_items/], [["down"], /rolled back 0001_create_items/], [["up"], /applied 0001_create_items/]]) {
		const r = runMigrate(dir, args, dbFile);
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, line);
	}
	assert.ok(fs.existsSync(path.join(dir, dbFile)));
	assert.match(runMigrate(dir, ["status"], dbFile).out, /\[x\] 0001_create_items[\s\S]*1 applied, 0 pending/);
	const created = runMigrate(dir, ["new", "add_price"], dbFile);
	assert.match(created.out, /created migrations[\\/]0002_add_price\.up\.sql/);
	assert.equal(runMigrate(dir, ["down", "zero"], dbFile).code, 2);
	assert.equal(runMigrate(dir, ["sideways"], dbFile).code, 2);
	fs.writeFileSync(path.join(dir, "migrations/0001_create_items.up.sql"), "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT, price INTEGER);\n");
	const edited = runMigrate(dir, ["up"], dbFile);
	assert.equal(edited.code, 1);
	assert.match(edited.out, /migrate: FAIL applied migrations must not change: 0001_create_items/);
});

test("the sample server refuses to start until its database is migrated", () => {
	const dir = copySample();
	const r = spawnSync(process.execPath, ["src/server.js"], { cwd: dir, encoding: "utf8", timeout: 10_000, env: { ...process.env, DB_FILE: "data/fresh.db", PORT: "0" } });
	assert.equal(r.status, 1);
	assert.match(r.stderr, /refusing to start: the database is not at the latest migration \(0001_create_items\)/);
});

test("redo applies, rolls back, and applies again, and logs the schema after each step", () => {
	const db = openDb(":memory:");
	const log = redo(db, migrationsDir(twoSteps));
	assert.deepEqual(log, [
		"migrate: applied 0001_create_items",
		"migrate: schema items(id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
		"migrate: applied 0002_add_price",
		"migrate: schema items(id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0)",
		"migrate: rolled back 0002_add_price",
		"migrate: schema items(id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
		"migrate: applied 0002_add_price",
		"migrate: schema items(id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL DEFAULT 0)",
	]);
	assert.match(redo(openDb(":memory:"), migrationsDir(twoSteps), 2).join("\n"), /schema \(empty\)[\s\S]*rolled back 0002_add_price\nmigrate: rolled back 0001_create_items\nmigrate: schema \(empty\)/);
});

test("redo fails when the down part does not undo the up part", () => {
	const leaky = { ...twoSteps, "0002_add_price.down.sql": "SELECT 1;", "0003_index_name.up.sql": "CREATE INDEX items_name ON items(name);", "0003_index_name.down.sql": "SELECT 1;" };
	assert.throws(() => redo(openDb(":memory:"), migrationsDir(leaky)), (e) => e instanceof MigrationError && /rolling back did not restore the schema/.test(e.message) && /after down: .*index items_name ON items/.test(e.message));
	assert.throws(() => redo(openDb(":memory:"), migrationsDir(twoSteps), 3), /redo 3 needs at least 3 migrations, found 2/);
});

test("the CLI redo works on the sample without writing a database file", () => {
	const dir = copySample();
	const r = runMigrate(dir, ["redo"], "data/should-not-exist.db");
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /applied 0001_create_items[\s\S]*rolled back 0001_create_items[\s\S]*applied 0001_create_items[\s\S]*migrate: redo ok/);
	assert.ok(!fs.existsSync(path.join(dir, "data/should-not-exist.db")), "redo must not touch DB_FILE");
	assert.equal(runMigrate(dir, ["redo", "0"], "x.db").code, 2);
});
