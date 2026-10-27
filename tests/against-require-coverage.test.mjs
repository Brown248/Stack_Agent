// By default a change to the code with no new check or test makes the against step skip, flagged, and verify passes (see
// no-coverage.test.mjs). A project can make that a failure with "against": { "requireNewCoverage": true }, so CI is a
// gate and not a reminder. A change that alters no behavior (a refactor, a rename) says so in a commit message since the
// base, in a "Stack-Agent-No-New-Test: <reason>" line, so the claim sits in the history where a reviewer reads it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ConfigError } from "../scripts/lib/files.mjs";
import { copyExample, git, repoRoot, runNode, write } from "./helpers.mjs";

const verify = (dir, extra = []) => runNode(path.join(repoRoot, "scripts/verify.mjs"), ["--root", dir, ...extra], { cwd: dir });
const sessionStart = (dir) => runNode(path.join(repoRoot, "scripts/hooks/session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "req" }) });
const latestAgainst = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8")).steps.find((s) => s.step === "against");

function job(against = { requireNewCoverage: true }) {
	const dir = copyExample("sample-generic");
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.against = against;
	fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	sessionStart(dir);
	return dir;
}
const addFunction = (dir) => fs.appendFileSync(path.join(dir, "src/transform.js"), "\nexport function monthlyTotals(rows) {\n\treturn rows.length;\n}\n");

test("with requireNewCoverage, a code change with no new check or test fails the run and says how to fix it", () => {
	const dir = job();
	addFunction(dir);
	const r = verify(dir);
	assert.equal(r.code, 1, r.stdout + r.stderr);
	assert.match(r.stdout + r.stderr, /FAIL against \w+: the code changed since \w+ but no check or test is new or changed \(against\.requireNewCoverage is set\)/);
	assert.match(r.stdout + r.stderr, /Stack-Agent-No-New-Test: <reason>/);
	const step = latestAgainst(dir);
	assert.equal(step.ok, false);
	assert.equal(step.noNewCoverage, true);
});

test("without the option the same change still passes with the flagged skip", () => {
	const dir = job({});
	addFunction(dir);
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /SKIP against: no new or changed checks or tests, but the code changed/);
});

test("a change with no code in it still skips, even with the option", () => {
	const dir = job();
	write(dir, "docs/notes.md", "# notes\n");
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.equal(latestAgainst(dir).skipped, "no new or changed checks or tests");
});

test("a commit message line with a reason waives it, and the reason is shown", () => {
	const dir = job();
	addFunction(dir);
	git(dir, "commit", "-qam", "rename a helper\n\nStack-Agent-No-New-Test: pure rename, same behavior, covered by the existing tests");
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /SKIP against: .*waived by a commit message since \w+: pure rename, same behavior, covered by the existing tests/);
	assert.equal(latestAgainst(dir).noNewCoverage, true);
});

test("a reason under 15 characters, or none, does not waive it", () => {
	const dir = job();
	addFunction(dir);
	git(dir, "commit", "-qam", "rename\n\nStack-Agent-No-New-Test: refactor");
	assert.equal(verify(dir).code, 1);
	git(dir, "commit", "-q", "--allow-empty", "-m", "more\n\nStack-Agent-No-New-Test:");
	assert.equal(verify(dir).code, 1);
	git(dir, "commit", "-q", "--allow-empty", "-m", "the line must start a line: see Stack-Agent-No-New-Test: pure rename, nothing else changed");
	assert.equal(verify(dir).code, 1);
});

test("a new test settles it without a waiver", () => {
	const dir = job();
	addFunction(dir);
	write(dir, "test/monthly.test.js", 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { monthlyTotals } from "../src/transform.js";\n\ntest("monthlyTotals counts the rows", () => {\n\tassert.equal(monthlyTotals([1, 2, 3]), 3);\n});\n');
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.notEqual(latestAgainst(dir).noNewCoverage, true);
});

test("requireNewCoverage must be true or false", () => {
	const dir = job({ requireNewCoverage: "yes" });
	const r = verify(dir);
	assert.equal(r.code, 2, r.stdout + r.stderr);
	assert.match(r.stderr, /against\.requireNewCoverage must be true or false/);
	assert.ok(ConfigError);
});
