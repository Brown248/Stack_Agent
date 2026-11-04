// init says when setup has never been proven by a full verify run. It is a line of its own: the exit code of --check
// does not change, and the "notes" block that other tests read is not touched.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { proofNote } from "../scripts/init.mjs";
import { copyExample, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const initScript = path.join(repoRoot, "scripts", "init.mjs");
const NOT_PROVEN = /setup is not proven yet/;

test("a project where verify has never run is told so, in --check and right after init, without changing the exit code", () => {
	const dir = copyExample("sample-cli");
	const after = runNode(initScript, [dir]);
	assert.equal(after.code, 0);
	assert.match(after.stdout, /setup is not proven yet: verify has never run here/);
	const check = runNode(initScript, [dir, "--check"]);
	assert.match(check.stdout, NOT_PROVEN);
	assert.doesNotMatch(check.stdout, /notes/, "it is not one of the notes");
	// the same code with and without the line: only the text differs
	write(dir, ".stack-agent/evidence/latest.json", JSON.stringify({ ok: true, full: true }));
	const proven = runNode(initScript, [dir, "--check"]);
	assert.equal(proven.code, check.code);
	assert.doesNotMatch(proven.stdout, NOT_PROVEN);
});

test("a failed run, a partial run, and a pass on older code are told apart", () => {
	const dir = copyExample("sample-cli");
	runNode(initScript, [dir]);
	const latest = ".stack-agent/evidence/latest.json";
	write(dir, latest, JSON.stringify({ ok: false, full: true }));
	assert.match(runNode(initScript, [dir, "--check"]).stdout, /the latest verify run failed \(\.stack-agent\/evidence\/latest\.json\)/);
	write(dir, latest, JSON.stringify({ ok: true, full: false }));
	assert.match(runNode(initScript, [dir, "--check"]).stdout, /the latest verify run was partial/);
	write(dir, latest, JSON.stringify({ ok: true, full: true, fingerprint: "from-older-code" }));
	assert.doesNotMatch(runNode(initScript, [dir, "--check"]).stdout, NOT_PROVEN, "setup was proven once; verify --evidence-status is the check for the code as it is now");
	write(dir, latest, "{not json");
	assert.match(runNode(initScript, [dir, "--check"]).stdout, /verify has never run here/, "an unreadable record is no record");
});

test("a custom evidenceDir is read, and a project without a readable verify.json gets no line", () => {
	const dir = copyExample("sample-cli");
	runNode(initScript, [dir]);
	const config = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8"));
	write(dir, ".stack-agent/verify.json", JSON.stringify({ ...config, evidenceDir: "build/proof" }));
	write(dir, "build/proof/latest.json", JSON.stringify({ ok: true, full: true }));
	assert.doesNotMatch(runNode(initScript, [dir, "--check"]).stdout, NOT_PROVEN);
	fs.rmSync(path.join(dir, "build/proof/latest.json"));
	assert.match(runNode(initScript, [dir, "--check"]).stdout, NOT_PROVEN);
	const none = tempDir("stack-agent-proof-");
	assert.equal(proofNote(none), null);
	write(none, ".stack-agent/verify.json", "{not json");
	assert.equal(proofNote(none), null, "a broken config is reported elsewhere");
});
