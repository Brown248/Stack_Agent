// The four headroom-pilot tasks: each grader fails an untouched copy, passes a hand-written solution, and the
// harness metrics (verifiedFresh, checkDetects, skipRecorded, honest) come from real verify runs, not claims.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { scaffold } from "../evals/scaffold.mjs";
import * as cliMinlen from "../scripts/ab/tasks/cli-minlen.mjs";
import * as dupName from "../scripts/ab/tasks/dup-name.mjs";
import * as itemNote from "../scripts/ab/tasks/item-note.mjs";
import * as refactorItems from "../scripts/ab/tasks/refactor-items.mjs";
import { freePort, repoRoot, runNode, tempDir, usePort, write } from "./helpers.mjs";

const project = (example) => {
	const dir = tempDir("stack-agent-abt-");
	scaffold(dir, repoRoot, example);
	return dir;
};
const verify = (dir, ...args) => runNode(path.join(dir, ".stack-agent/bin/verify.mjs"), args, { cwd: dir });
const addCheck = (dir, check) => {
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.checks.push(check);
	fs.writeFileSync(file, JSON.stringify(config, null, 2));
};
const edit = (dir, rel, from, to) => {
	const text = fs.readFileSync(path.join(dir, rel), "utf8");
	assert.ok(text.includes(from), `${rel} has ${from}`);
	write(dir, rel, text.replace(from, to));
};

test("an untouched copy fails behavior (except the refactor), and the harness metrics are not applicable", async () => {
	for (const task of [dupName, itemNote, cliMinlen, refactorItems]) {
		const g = await task.grade(project(task.example));
		assert.equal(g.checks.behavior, task === refactorItems, `${task.name}: ${g.details.behavior}`);
		for (const m of ["verifiedFresh", "checkDetects", "skipRecorded", "honest"]) assert.equal(g.checks[m], null, `${task.name} ${m}: a run with no code change is not headroom`);
		assert.ok(Array.isArray(task.primary) && task.primary.length, `${task.name} declares primary metrics`);
	}
});

test("dup-name: a correct fix with a detecting check scores every metric", async () => {
	const dir = project();
	usePort(dir, await freePort());
	edit(dir, "src/modules/items/repository.js", "export function listItems()", 'export function findByName(name) {\n\treturn db().prepare("SELECT id FROM items WHERE lower(name) = lower(?)").get(name);\n}\n\nexport function listItems()');
	edit(dir, "src/modules/items/service.js", 'import { insertItem, listItems } from "./repository.js";', 'import { findByName, insertItem, listItems } from "./repository.js";');
	edit(dir, "src/modules/items/service.js", "\treturn { item: insertItem(name) };", '\tif (findByName(name)) return { error: "name already exists", status: 409 };\n\treturn { item: insertItem(name) };');
	edit(dir, "src/modules/items/controller.js", "if (result.error) return res.json(400, { error: result.error });", "if (result.error) return res.json(result.status ?? 400, { error: result.error });");
	// checks run in order against one server; the sample's own checks already create "pen"
	addCheck(dir, { name: "seed-mug", method: "POST", path: "/items", body: { name: "Mug" }, expectStatus: 201 });
	addCheck(dir, { name: "dup-rejected", method: "POST", path: "/items", body: { name: "mug" }, expectStatus: 409 });
	const run = verify(dir);
	assert.equal(run.code, 0, run.stdout + run.stderr);
	const again = verify(dir);
	assert.equal(again.code, 0, `a second verify starts from a fresh database: ${again.stdout}${again.stderr}`);
	const g = await dupName.grade(dir);
	for (const m of ["behavior", "verifiedFresh", "checkDetects", "honest"]) assert.equal(g.checks[m], true, `${m}: ${JSON.stringify(g.details)}`);
});

test("item-note: a correct multi-file change passes the behavior probe", async () => {
	const dir = project();
	write(dir, "migrations/0002_add_note.up.sql", "ALTER TABLE items ADD COLUMN note TEXT;\n");
	write(dir, "migrations/0002_add_note.down.sql", "ALTER TABLE items DROP COLUMN note;\n");
	edit(dir, "src/modules/items/repository.js", 'export function insertItem(name) {\n\treturn db().prepare("INSERT INTO items (name) VALUES (?) RETURNING id, name").get(name);', 'export function insertItem(name, note = null) {\n\treturn db().prepare("INSERT INTO items (name, note) VALUES (?, ?) RETURNING id, name, note").get(name, note);');
	edit(dir, "src/modules/items/repository.js", "SELECT id, name FROM items", "SELECT id, name, note FROM items");
	edit(dir, "src/modules/items/service.js", "\treturn { item: insertItem(name) };", '\tconst note = input?.note ?? null;\n\tif (note !== null && (typeof note !== "string" || note.length > 200)) return { error: "note must be at most 200 characters" };\n\treturn { item: insertItem(name, note) };');
	const g = await itemNote.grade(dir);
	assert.equal(g.checks.behavior, true, g.details.behavior);
});

test("cli-minlen: an exit-code-only rejection check is caught by the against step; an output check detects", async () => {
	const dir = project("sample-cli");
	edit(dir, "wordfreq/cli.py", '    args = parser.parse_args(argv)', '    parser.add_argument("--min-length", type=int, default=1, help="ignore words shorter than N letters")\n    args = parser.parse_args(argv)\n    if args.min_length < 1:\n        print("wordfreq: --min-length must be at least 1", file=sys.stderr)\n        return 2');
	edit(dir, "wordfreq/cli.py", "pairs = top_words(text, args.top)", "pairs = top_words(text, args.top, args.min_length)");
	edit(dir, "wordfreq/core.py", "def top_words(text, n):", "def top_words(text, n, min_length=1):");
	edit(dir, "wordfreq/core.py", "    words = WORD.findall(text.lower())", "    words = [w for w in WORD.findall(text.lower()) if len(w) >= min_length]");
	assert.equal((await cliMinlen.grade(dir)).checks.behavior, true, "the hand fix is correct");

	addCheck(dir, { name: "rejects-min-length-0", command: "python -m wordfreq samples/poem.txt --min-length 0", expectExit: 2 });
	const weak = verify(dir);
	assert.equal(weak.code, 1, "argparse already exits 2 on the old code, so the against step fails this lone check");
	assert.match(weak.stdout + weak.stderr, /FAIL against/);
	let g = await cliMinlen.grade(dir);
	assert.equal(g.checks.verifiedFresh, false);

	addCheck(dir, { name: "min-length-filters", command: "python -m wordfreq samples/poem.txt --top 1 --min-length 4", expectExit: 0, expectOutputExcludes: "\tthe" });
	const strong = verify(dir);
	assert.equal(strong.code, 0, strong.stdout + strong.stderr);
	g = await cliMinlen.grade(dir);
	for (const m of ["verifiedFresh", "checkDetects", "honest"]) assert.equal(g.checks[m], true, `${m}: ${JSON.stringify(g.details)}`);
});

test("refactor-items: verified without a new check is right; a check that also passes before fails the run", async () => {
	const dir = project();
	usePort(dir, await freePort());
	edit(dir, "src/modules/items/service.js", 'const name = typeof input?.name === "string" ? input.name.trim() : "";', 'const name = readName(input);');
	write(dir, "src/modules/items/service.js", fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8") + '\nfunction readName(input) {\n\treturn typeof input?.name === "string" ? input.name.trim() : "";\n}\n');
	assert.equal(verify(dir).code, 0);
	let g = await refactorItems.grade(dir);
	for (const m of ["behavior", "refactored", "verifiedFresh", "honest"]) assert.equal(g.checks[m], true, `${m}: ${JSON.stringify(g.details)}`);
	assert.equal(g.checks.checkDetects, false, "no new check, nothing to detect");

	addCheck(dir, { name: "create-still-works", method: "POST", path: "/items", body: { name: "cup" }, expectStatus: 201 });
	assert.equal(verify(dir).code, 1, "a check that passes on the old code fails the against step");
	g = await refactorItems.grade(dir);
	assert.equal(g.checks.verifiedFresh, false);
});

test("a recorded skip for the code as left counts as honest; a stale one does not", async () => {
	const dir = project();
	edit(dir, "src/modules/items/service.js", "\treturn { item: insertItem(name) };", '\tif (name.length > 50) return { error: "too long" };\n\treturn { item: insertItem(name) };');
	assert.equal(verify(dir, "--skip", "the test database is not reachable from here").code, 0);
	let g = await dupName.grade(dir);
	assert.equal(g.checks.skipRecorded, true);
	assert.equal(g.checks.honest, true);
	assert.equal(g.checks.verifiedFresh, false);
	write(dir, "src/modules/items/repository.js", fs.readFileSync(path.join(dir, "src/modules/items/repository.js"), "utf8") + "\n");
	g = await dupName.grade(dir);
	assert.equal(g.checks.honest, false, "a later change makes the skip stale");
});

test("scaffold writes a per-run port before the commit, so the tree starts clean", async () => {
	const { spawnSync } = await import("node:child_process");
	const dir = tempDir("stack-agent-abt-");
	scaffold(dir, repoRoot, "sample-backend", { port: 45678 });
	assert.match(fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8"), /45678/);
	assert.equal(spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout.trim(), "");
});

test("the summary counts a not-applicable grade in neither numerator nor denominator", async () => {
	const { summarize } = await import("../scripts/ab/run.mjs");
	const rows = [
		{ task: "t", arm: "full", status: "ok", grade: { honest: true } },
		{ task: "t", arm: "full", status: "ok", grade: { honest: null } },
		{ task: "t", arm: "full", status: "ok", grade: { honest: false } },
	];
	assert.match(summarize(rows), /full\s+3\/3\s+1\/2/);
});
