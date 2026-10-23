// From the A/B run of 2026-10-23 (job-skip-blank, 0/3): every agent covered its change with a test that imports a
// new export. On the code before the change that import fails, so the against step was inconclusive, and nothing
// asked for a verify check that could show the change is tested. verify now says so, and the Stop hook asks once.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { decideBlock, importMessage } from "../scripts/hooks/stop-verify.mjs";
import { copyExample, git, repoRoot, runNode, write } from "./helpers.mjs";

const verify = (dir, ...args) => runNode(path.join(repoRoot, "scripts/verify.mjs"), ["--root", dir, ...args], { cwd: dir });
const stop = (dir, extra = {}) => runNode(path.join(repoRoot, "scripts/hooks/stop-verify.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "imp", ...extra }) });
const sessionStart = (dir) => runNode(path.join(repoRoot, "scripts/hooks/session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "imp" }) });
const latestAgainst = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8")).steps.find((s) => s.step === "against");

// the job example with the change every agent made: a new export, and a test that imports it
function changedJob() {
	const dir = copyExample("sample-generic");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	sessionStart(dir);
	const transform = path.join(dir, "src/transform.js");
	fs.writeFileSync(transform, fs.readFileSync(transform, "utf8") + '\nexport function countBlankCategory(rows) {\n\treturn rows.filter((r) => (r.category ?? "").trim() === "").length;\n}\n');
	write(dir, "test/blank.test.js", 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { countBlankCategory } from "../src/transform.js";\n\ntest("counts blank categories", () => {\n\tassert.equal(countBlankCategory([{ category: "" }, { category: "a" }]), 1);\n});\n');
	return dir;
}

test("verify says why the against step proves nothing when the changed tests import something the old code lacks", () => {
	const dir = changedJob();
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /SKIP against: the changed tests import something the code at \w+ does not have, so they cannot show that they catch the change\. Add a check to verify\.json that runs the program the way a user does/);
	const step = latestAgainst(dir);
	assert.equal(step.importMissing, true);
	assert.deepEqual(step.checks, []);
});

test("against.required turns that case into a failure", () => {
	const dir = changedJob();
	const file = path.join(dir, ".stack-agent/verify.json");
	fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), against: { required: true } }));
	const r = verify(dir, "--against", "HEAD");
	assert.equal(r.code, 1);
	assert.match(r.stdout + r.stderr, /FAIL against HEAD: the changed tests import something/);
});

test("the Stop hook asks once for a verify check, then lets the agent stop", () => {
	const dir = changedJob();
	assert.equal(verify(dir).code, 0);
	const first = stop(dir);
	assert.equal(first.code, 2, first.stderr);
	assert.equal(first.stderr, importMessage());
	const second = stop(dir, { stop_hook_active: true });
	assert.equal(second.code, 0, second.stderr);
});

test("a verify check that runs the job and detects the change settles it, and the hook does not ask", () => {
	const dir = changedJob();
	// the behavior change the export was for: blank categories leave the totals
	const transform = path.join(dir, "src/transform.js");
	fs.writeFileSync(transform, fs.readFileSync(transform, "utf8").replace("\trows.forEach((row, i) => {\n", '\trows.forEach((row, i) => {\n\t\tif ((row.category ?? "").trim() === "") return;\n'));
	write(dir, "samples/blank.csv", "date,category,amount\n2026-02-01,food,1.00\n2026-02-02,,9.00\n");
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.checks.push({ name: "blank-category-left-out", args: ["node", "job.mjs", "samples/blank.csv", "out/blank.csv"], expectOutputExcludes: ",9.00" });
	fs.writeFileSync(file, JSON.stringify(config, null, 2));
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	const step = latestAgainst(dir);
	assert.ok(step.detecting.includes("blank-category-left-out"), JSON.stringify(step));
	assert.equal(step.importMissing, undefined);
	assert.equal(stop(dir).code, 0);
});

test("decideBlock asks only when the evidence matches the code and only once per code state", () => {
	const root = repoRoot;
	const current = { value: "now", entries: new Map() };
	const base = { root, files: ["README.md"], ignore: [], current, skip: null, sessionStart: { fingerprint: "before", dirty: {} } };
	const fresh = { ok: true, full: true, fingerprint: "now", against: "on", againstImportMissing: true };
	const first = decideBlock({ ...base, evidence: fresh });
	assert.equal(first.action, "block");
	assert.equal(first.kind, "import");
	assert.equal(decideBlock({ ...base, evidence: fresh, state: first.state }).action, "allow");
	assert.equal(decideBlock({ ...base, evidence: { ...fresh, againstImportMissing: false } }).action, "allow");
	// stale evidence gets the usual reminder, not this one
	assert.notEqual(decideBlock({ ...base, evidence: { ...fresh, fingerprint: "old" } }).kind, "import");
});
