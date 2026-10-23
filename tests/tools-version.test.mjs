import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { staleReason } from "../scripts/hooks/stop-verify.mjs";
import { FINGERPRINT_VERSION } from "../scripts/lib/fingerprint.mjs";
import { main as verify } from "../scripts/verify.mjs";
import { copyExample, copySample, git, repoRoot, runNode, tempDir } from "./helpers.mjs";

const sessionStart = (dir) => runNode(path.join(repoRoot, "scripts/hooks/session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "tools" }) });

function initialized() {
	const dir = tempDir();
	git(dir, "init", "-q");
	assert.equal(runNode(path.join(repoRoot, "scripts/init.mjs"), [dir]).code, 0);
	return dir;
}

test("SessionStart is silent when the vendored tools match the plugin", () => {
	const r = sessionStart(initialized());
	assert.equal(r.code, 0, r.stderr);
	assert.equal(r.stdout, "");
});

test("SessionStart tells the human which vendored tools differ from the plugin, and how to refresh them", () => {
	const dir = initialized();
	fs.appendFileSync(path.join(dir, ".stack-agent/bin/guard.mjs"), "// older copy\n");
	fs.writeFileSync(path.join(dir, ".stack-agent/bin/VERSION"), "0.1.0\n");
	const r = sessionStart(dir);
	assert.equal(r.code, 0, r.stderr);
	const { systemMessage } = JSON.parse(r.stdout);
	assert.match(systemMessage, /tools in \.stack-agent\/bin \(version 0\.1\.0\) differ from this plugin's copy \(version \d+\.\d+\.\d+\): guard\.mjs, VERSION/);
	assert.match(systemMessage, /init\.mjs/);
	// the session record is still written
	assert.ok(fs.readdirSync(path.join(dir, ".stack-agent/evidence/sessions")).some((f) => f.endsWith(".start.json")));
});

test("SessionStart says nothing about tools in a project that has no .stack-agent/bin", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	assert.equal(sessionStart(dir).stdout, "");
});

test("evidence records the fingerprint version", async () => {
	const dir = copyExample("sample-generic");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	const r = await verify(["--root", dir, "--no-against"]);
	assert.equal(r.code, 0, r.text);
	const latest = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8"));
	assert.equal(latest.fingerprintVersion, FINGERPRINT_VERSION);
});

test("the Stop hook says why evidence from a verify with another fingerprint version can never match", () => {
	const current = { value: "now" };
	const base = { ok: true, full: true, against: "on", fingerprint: "then" };
	assert.match(staleReason({ ...base, fingerprintVersion: FINGERPRINT_VERSION + 1 }, current, 0), /computes fingerprints differently .*refresh \.stack-agent\/bin/);
	// evidence written before the field existed was computed as version 1 does
	assert.equal(staleReason(base, current, 0), "the code changed after the latest passing verify run");
	assert.equal(staleReason({ ...base, fingerprintVersion: FINGERPRINT_VERSION }, current, 0), "the code changed after the latest passing verify run");
	// a matching fingerprint settles it whatever the version
	assert.equal(staleReason({ ...base, fingerprint: "now", fingerprintVersion: FINGERPRINT_VERSION + 1 }, current, 0), null);
});
