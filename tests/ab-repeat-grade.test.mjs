// The intermittent-bug tasks grade whether the agent measured a red rate with `verify.mjs --repeat`. These tests walk
// it by hand: fake evidence for the grader's rules, and a real repeat run on the planted bug-flaky-list project.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { scaffold } from "../evals/scaffold.mjs";
import { repeatGrade } from "../scripts/ab/lib.mjs";
import * as task from "../scripts/ab/tasks/bug-flaky-list.mjs";
import { freePort, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

test("repeatGrade counts a repeat run that went red, from any evidence file", () => {
	const dir = tempDir("stack-agent-abr-");
	const run = (name, steps) => write(dir, `.stack-agent/evidence/verify-${name}.json`, JSON.stringify({ ok: false, full: false, steps }));
	assert.deepEqual(repeatGrade(dir), { checks: { redRateMeasured: false }, details: { repeat: "no --repeat run" } });
	run("2026-10-26T01", [{ step: "repeat", name: "list", runs: 20, red: 0 }]);
	assert.equal(repeatGrade(dir).checks.redRateMeasured, false, "a rate taken after the fix measures nothing");
	run("2026-10-26T02", [{ step: "repeat", name: "list", runs: 20, red: 6 }]);
	run("2026-10-26T03", [{ step: "tests", ok: true }]);
	assert.deepEqual(repeatGrade(dir), { checks: { redRateMeasured: true }, details: { repeat: "list red 0/20, list red 6/20" } });
});

test("a repro check repeated on the planted bug-flaky-list bug goes red some of the time, and the task grades it", async () => {
	const dir = tempDir("stack-agent-abr-");
	scaffold(dir, repoRoot, task.example, { port: await freePort() });
	await task.setup(dir);
	// what an agent would add: a command check that creates an item and reads the list right away, a few times
	write(
		dir,
		"scripts/repro-list.mjs",
		`const base = process.env.BASE_URL;
for (let i = 0; i < 5; i++) {
	const name = "repro-" + Date.now() + "-" + i;
	await fetch(base + "/items");
	await fetch(base + "/items", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
	const items = (await (await fetch(base + "/items")).json()).items.map((x) => x.name);
	if (!items.includes(name)) { console.log("missing " + name); process.exit(1); }
}
console.log("listed");
`,
	);
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.checks.push({ name: "list-after-create", args: [process.execPath, "scripts/repro-list.mjs"], env: { BASE_URL: config.baseUrl }, needsServer: true });
	fs.writeFileSync(file, JSON.stringify(config, null, 2));

	const r = runNode(path.join(dir, ".stack-agent/bin/verify.mjs"), ["--check", "list-after-create", "--repeat", "12"], { cwd: dir });
	const out = r.stdout + r.stderr;
	assert.equal(r.code, 1, out);
	const m = /red in (\d+) of 12 runs/.exec(out);
	assert.ok(m && Number(m[1]) > 0, out);
	assert.match(out, /first red \(run \d+\):\nmissing repro-/);
	const g = repeatGrade(dir);
	assert.equal(g.checks.redRateMeasured, true, JSON.stringify(g.details));
	assert.match(g.details.repeat, /^list-after-create red [1-9]\d*\/12$/);
});
