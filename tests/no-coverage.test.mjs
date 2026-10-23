// From the job-new-export A/B runs (2026-10-23): in one run of each round the agent changed the code, wrote no test
// and no check, ran verify, and stopped. The against step had nothing to run, so it skipped, and nothing asked for a
// test. verify now flags that case, and the Stop hook asks once for a test or check; a refactor can say so and stop.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { coverageMessage, decideBlock } from "../scripts/hooks/stop-verify.mjs";
import { copyExample, git, repoRoot, runNode, write } from "./helpers.mjs";

const verify = (dir) => runNode(path.join(repoRoot, "scripts/verify.mjs"), ["--root", dir], { cwd: dir });
const stop = (dir, extra = {}) => runNode(path.join(repoRoot, "scripts/hooks/stop-verify.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "cov", ...extra }) });
const sessionStart = (dir) => runNode(path.join(repoRoot, "scripts/hooks/session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "cov" }) });
const latestAgainst = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8")).steps.find((s) => s.step === "against");

function job() {
	const dir = copyExample("sample-generic");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	sessionStart(dir);
	return dir;
}
// what run 4 did: a new function in the transform, no test, no check
const addFunction = (dir) => fs.appendFileSync(path.join(dir, "src/transform.js"), "\nexport function monthlyTotals(rows) {\n\treturn rows.length;\n}\n");

test("verify says when the code changed but no check or test is new, and flags it", () => {
	const dir = job();
	addFunction(dir);
	const r = verify(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /SKIP against: no new or changed checks or tests, but the code changed since \w+, so nothing shows the change is tested\. If it changes behavior, add a test or a check to verify\.json that fails without it; if it does not \(a refactor\), say so/);
	assert.equal(latestAgainst(dir).noNewCoverage, true);
});

test("the Stop hook asks once for a test or check, naming the changed files, then lets the agent stop", () => {
	const dir = job();
	addFunction(dir);
	assert.equal(verify(dir).code, 0);
	const first = stop(dir);
	assert.equal(first.code, 2, first.stderr);
	assert.equal(first.stderr, coverageMessage(["src/transform.js"]));
	assert.match(first.stderr, /no check or test is new or changed while the code is \(src\/transform\.js\)/);
	assert.match(first.stderr, /If nothing a user can observe changed \(a refactor, a rename\), say so in your final message and stop; this is asked once/);
	assert.equal(stop(dir, { stop_hook_active: true }).code, 0, "asked once");
});

test("a new test settles it: the hook does not ask", () => {
	const dir = job();
	addFunction(dir);
	write(dir, "test/monthly.test.js", 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { totalsByCategory } from "../src/transform.js";\n\ntest("still totals", () => {\n\tassert.equal(totalsByCategory([]).length, 0);\n});\n');
	assert.equal(verify(dir).code, 0);
	assert.notEqual(latestAgainst(dir).noNewCoverage, true);
	assert.equal(stop(dir).code, 0);
});

test("a change only to files the fingerprint ignores (docs) is not flagged", () => {
	const dir = job();
	write(dir, "docs/notes.md", "# notes\n");
	assert.equal(verify(dir).code, 0);
	const step = latestAgainst(dir);
	assert.equal(step.skipped, "no new or changed checks or tests");
	assert.equal(step.noNewCoverage, undefined);
});

test("decideBlock asks for coverage only on evidence that matches the code, once per code state, after the import request", () => {
	const current = { value: "now", entries: new Map() };
	const base = { root: repoRoot, files: ["README.md"], ignore: [], current, skip: null, sessionStart: { fingerprint: "before", dirty: {} } };
	const fresh = { ok: true, full: true, fingerprint: "now", against: "on", againstNoCoverage: true };
	const first = decideBlock({ ...base, evidence: fresh });
	assert.equal(first.kind, "coverage");
	assert.equal(decideBlock({ ...base, evidence: fresh, state: first.state }).action, "allow");
	assert.equal(decideBlock({ ...base, evidence: { ...fresh, fingerprint: "old" } }).kind, undefined, "stale evidence gets the usual reminder");
	assert.equal(decideBlock({ ...base, evidence: { ...fresh, againstImportMissing: true } }).kind, "import", "the import case has its own request");
});
