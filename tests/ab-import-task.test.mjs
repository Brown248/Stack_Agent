// job-new-export is built to reach the "changed tests import what the old code lacks" case with real agents. These
// tests walk the two endings by hand: a fix covered only by a test that imports the new export (the case comes up,
// no check follows), and the same fix after the Stop hook's request, with a verify check that detects it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { scaffold } from "../evals/scaffold.mjs";
import { importCaseGrade } from "../scripts/ab/lib.mjs";
import * as task from "../scripts/ab/tasks/job-new-export.mjs";
import { repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const project = () => {
	const dir = tempDir("stack-agent-abi-");
	scaffold(dir, repoRoot, task.example);
	return dir;
};
const verify = (dir) => runNode(path.join(dir, ".stack-agent/bin/verify.mjs"), [], { cwd: dir });
const sessionStart = (dir) => runNode(path.join(repoRoot, "scripts/hooks/session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "abi" }) });
const stop = (dir, extra = {}) => runNode(path.join(repoRoot, "scripts/hooks/stop-verify.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "abi", ...extra }) });
const edit = (dir, rel, from, to) => {
	const text = fs.readFileSync(path.join(dir, rel), "utf8");
	assert.ok(text.includes(from), `${rel} has ${from}`);
	write(dir, rel, text.replace(from, to));
};

// the change an agent makes: the function and its export, and a test that imports it
function implement(dir) {
	edit(
		dir,
		"src/transform.js",
		"// amounts are summed in cents so 0.1 + 0.2 stays exact",
		`export function monthlyTotals(rows) {
	if (!Array.isArray(rows)) throw new TypeError("monthlyTotals expects an array of rows");
	// the same exact cents as totalsByCategory, with the month as the category
	return totalsByCategory(rows.map((r) => ({ category: r.date.slice(0, 7), amount: r.amount })))
		.map((t) => ({ month: t.category, cents: t.cents }))
		.sort((a, b) => a.month.localeCompare(b.month));
}

// amounts are summed in cents so 0.1 + 0.2 stays exact`,
	);
	edit(dir, "test/transform.test.js", 'import { parseCsv, toCsv, totalsByCategory } from "../src/transform.js";', 'import { monthlyTotals, parseCsv, toCsv, totalsByCategory } from "../src/transform.js";');
	fs.appendFileSync(path.join(dir, "test/transform.test.js"), '\ntest("monthlyTotals sums per month", () => {\n\tassert.deepEqual(monthlyTotals([{ date: "2026-01-02", amount: "1.00" }, { date: "2026-01-09", amount: "0.50" }]), [{ month: "2026-01", cents: 150 }]);\n});\n');
}

test("an untouched copy fails the probe, and the import metrics are not applicable", async () => {
	const g = await task.grade(project());
	assert.equal(g.checks.behavior, false, g.details.behavior);
	assert.equal(g.checks.importCase, null);
	assert.equal(g.checks.checkAfterImport, null);
	assert.ok(task.primary.includes("importCase") && task.rubric.length);
});

test("a fix tested only by a test that imports the new export hits the import case, and the Stop hook asks once", async () => {
	const dir = project();
	sessionStart(dir);
	implement(dir);
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /SKIP against: the changed tests import something the code at \w+ does not have/);
	const g = await task.grade(dir);
	assert.equal(g.checks.behavior, true, g.details.behavior);
	assert.equal(g.checks.verifiedFresh, true);
	assert.equal(g.checks.checkDetects, false);
	assert.equal(g.checks.importCase, true, g.details.importCase);
	assert.equal(g.checks.checkAfterImport, false);
	const asked = stop(dir);
	assert.equal(asked.code, 2);
	assert.match(asked.stderr, /changed tests import something the code before the change does not have/);
	assert.equal(stop(dir, { stop_hook_active: true }).code, 0, "asked once");
});

test("after the request, a verify check that runs the new function on the real data detects the change", async () => {
	const dir = project();
	sessionStart(dir);
	implement(dir);
	assert.equal(verify(dir).code, 0);
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.checks.push({ name: "monthly-totals", args: ["node", "--input-type=module", "-e", "import { monthlyTotals, parseCsv } from './src/transform.js'; import fs from 'node:fs'; console.log(JSON.stringify(monthlyTotals(parseCsv(fs.readFileSync('data/expenses.csv', 'utf8')))))"], expectOutputIncludes: '"month":"2026-01"' });
	fs.writeFileSync(file, JSON.stringify(config, null, 2));
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	const g = await task.grade(dir);
	for (const m of ["behavior", "verifiedFresh", "checkDetects", "honest", "importCase", "checkAfterImport"]) assert.equal(g.checks[m], true, `${m}: ${JSON.stringify(g.details)}`);
	assert.equal(stop(dir).code, 0);
});

test("importCaseGrade reads the session's evidence history, not only the latest run", () => {
	const dir = tempDir("stack-agent-abi-");
	const run = (name, steps, ok = true) => write(dir, `.stack-agent/evidence/verify-${name}.json`, JSON.stringify({ ok, full: true, steps }));
	assert.deepEqual(importCaseGrade(dir).checks, { importCase: false, checkAfterImport: null });
	run("2026-10-23T01", [{ step: "against", ok: true, skipped: "x", importMissing: true }]);
	assert.deepEqual(importCaseGrade(dir).checks, { importCase: true, checkAfterImport: false });
	run("2026-10-23T02", [{ step: "against", ok: true, detecting: ["tests (node --test)"] }]);
	assert.equal(importCaseGrade(dir).checks.checkAfterImport, false, "detection by tests alone is not a check");
	run("2026-10-23T03", [{ step: "against", ok: true, detecting: ["tests (node --test)", "monthly-totals"] }]);
	assert.equal(importCaseGrade(dir).checks.checkAfterImport, true);
	write(dir, ".stack-agent/evidence/verify-2026-10-23T04.json", JSON.stringify({ ok: true, full: false, steps: [] }));
	assert.equal(importCaseGrade(dir).checks.checkAfterImport, true, "a partial run does not count");
});
