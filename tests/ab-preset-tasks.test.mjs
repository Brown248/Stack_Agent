// A/B tasks for the library, frontend-web, and generic presets: each grader fails an untouched copy and passes a
// hand-written solution, and the harness metrics come from real verify runs with a check that detects the change.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { scaffold } from "../evals/scaffold.mjs";
import * as jobSkipBlank from "../scripts/ab/tasks/job-skip-blank.mjs";
import * as libMaxlength from "../scripts/ab/tasks/lib-maxlength.mjs";
import * as webRoundup from "../scripts/ab/tasks/web-roundup.mjs";
import { freePort, repoRoot, runNode, tempDir, usePort, write } from "./helpers.mjs";

const project = (example) => {
	const dir = tempDir("stack-agent-abp-");
	scaffold(dir, repoRoot, example);
	return dir;
};
const verify = (dir) => runNode(path.join(dir, ".stack-agent/bin/verify.mjs"), [], { cwd: dir });
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
const HARNESS = ["verifiedFresh", "checkDetects", "honest"];

test("each preset task fails an untouched copy, and its harness metrics are not applicable", async () => {
	for (const task of [libMaxlength, webRoundup, jobSkipBlank]) {
		const g = await task.grade(project(task.example));
		assert.equal(g.checks.behavior, false, `${task.name}: ${g.details.behavior}`);
		for (const m of ["verifiedFresh", "checkDetects", "skipRecorded", "honest"]) assert.equal(g.checks[m], null, `${task.name} ${m}`);
		assert.ok(task.rubric.length && task.primary.length, task.name);
	}
});

test("lib-maxlength: a correct option passes through the built package, and a check on src detects it", async () => {
	const dir = project("sample-library");
	write(dir, "src/slugify.js", `import { foldAccents } from "./internal/normalize.js";

export function slugify(text, { separator = "-", maxLength } = {}) {
	if (typeof text !== "string") throw new TypeError("slugify expects a string");
	if (maxLength !== undefined && !(Number.isInteger(maxLength) && maxLength > 0)) throw new RangeError("maxLength must be a positive whole number");
	let slug = foldAccents(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(separator);
	if (maxLength !== undefined) {
		slug = slug.slice(0, maxLength);
		while (slug.endsWith(separator)) slug = slug.slice(0, -separator.length);
	}
	return slug;
}

export function isSlug(text) {
	return typeof text === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text);
}
`);
	assert.equal((await libMaxlength.grade(dir)).checks.behavior, true, "the hand fix is correct");
	addCheck(dir, { name: "max-length-cuts", args: ["node", "--input-type=module", "-e", "import { slugify } from './src/index.js'; console.log(slugify('Creme Brulee: A Recipe', { maxLength: 6 }))"], expectOutputMatches: "^creme\\r?$" });
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	const g = await libMaxlength.grade(dir);
	for (const m of HARNESS) assert.equal(g.checks[m], true, `${m}: ${JSON.stringify(g.details)}`);
});

test("web-roundup: a correct checkbox passes the served page and code, and a check through the server detects it", async () => {
	const dir = project("sample-frontend");
	usePort(dir, await freePort());
	edit(dir, "src/shared/format.js", "export function splitBill(total, people, tipPercent = 0) {", "export function splitBill(total, people, tipPercent = 0, roundUp = false) {");
	edit(dir, "src/shared/format.js", "\tconst each = Math.ceil(cents / people);", "\tconst exact = Math.ceil(cents / people);\n\tconst each = roundUp ? Math.ceil(exact / 100) * 100 : exact;");
	edit(dir, "src/client/index.html", '<label>People <input name="people" type="number" min="1" step="1" value="4"></label>', '<label>People <input name="people" type="number" min="1" step="1" value="4"></label>\n\t\t\t<label><input name="roundUp" type="checkbox"> Round up to whole dollars</label>');
	edit(dir, "src/client/app.js", 'Number(data.get("tip")))', 'Number(data.get("tip")), data.get("roundUp") === "on")');
	assert.equal((await webRoundup.grade(dir)).checks.behavior, true, "the hand fix is correct");
	addCheck(dir, { name: "round-up-share", needsServer: true, args: ["node", "--input-type=module", "-e", "const r = await fetch(process.env.BASE_URL + '/shared/format.js'); const { splitBill } = await import('data:text/javascript,' + encodeURIComponent(await r.text())); console.log(splitBill(50, 3, 0, true))"], env: { BASE_URL: JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8")).baseUrl }, expectOutputMatches: "^\\$17\\.00\\r?$" });
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	const g = await webRoundup.grade(dir);
	for (const m of HARNESS) assert.equal(g.checks[m], true, `${m}: ${JSON.stringify(g.details)}`);
});

test("job-skip-blank: a correct transform passes the job run, and a check on a blank-category file detects it", async () => {
	const dir = project("sample-generic");
	edit(dir, "src/transform.js", "export function totalsByCategory(rows) {", 'export function withCategory(rows) {\n\tconst kept = rows.filter((r) => (r.category ?? "").trim() !== "");\n\treturn { rows: kept, skipped: rows.length - kept.length };\n}\n\nexport function totalsByCategory(rows) {');
	edit(dir, "job.mjs", 'import { parseCsv, toCsv, totalsByCategory } from "./src/transform.js";', 'import { parseCsv, toCsv, totalsByCategory, withCategory } from "./src/transform.js";');
	edit(dir, "job.mjs", 'const csv = toCsv(totalsByCategory(parseCsv(fs.readFileSync(input, "utf8"))));', 'const { rows, skipped } = withCategory(parseCsv(fs.readFileSync(input, "utf8")));\nconst csv = toCsv(totalsByCategory(rows));');
	edit(dir, "job.mjs", "console.log(`wrote ${output}", "if (skipped) console.log(`left out ${skipped} row(s) with no category`);\nconsole.log(`wrote ${output}");
	const fixed = await jobSkipBlank.grade(dir);
	assert.equal(fixed.checks.behavior, true, `the hand fix is correct: ${fixed.details.behavior}`);
	write(dir, "samples/blank-category.csv", "date,category,amount\n2026-02-01,travel,10.00\n2026-02-02,,99.99\n");
	addCheck(dir, { name: "blank-category-left-out", args: ["node", "job.mjs", "samples/blank-category.csv", "out/blank.csv"], expectOutputMatches: "^left out 1 row\\(s\\) with no category\\r?$", expectOutputExcludes: "99.99" });
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	const g = await jobSkipBlank.grade(dir);
	for (const m of HARNESS) assert.equal(g.checks[m], true, `${m}: ${JSON.stringify(g.details)}`);
});

test("scaffold keeps an example's committed data and leaves out only database files", () => {
	const dir = project("sample-generic");
	assert.ok(fs.existsSync(path.join(dir, "data/expenses.csv")), "sample-generic's input CSV is committed data");
	const src = tempDir("stack-agent-scaffold-src-");
	write(src, "examples/withdb/data/app.db", "x");
	write(src, "examples/withdb/data/app.db-wal", "x");
	write(src, "examples/withdb/data/seed.csv", "a\n");
	write(src, "examples/withdb/package.json", "{}");
	const out = tempDir("stack-agent-scaffold-out-");
	try {
		scaffold(out, src, "withdb");
	} catch {
		// init needs the plugin's own files; only the copy matters here
	}
	assert.ok(fs.existsSync(path.join(out, "data/seed.csv")));
	assert.ok(!fs.existsSync(path.join(out, "data/app.db")));
	assert.ok(!fs.existsSync(path.join(out, "data/app.db-wal")));
});
