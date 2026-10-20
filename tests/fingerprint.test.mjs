import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { codeFingerprint, fingerprintDiff } from "../scripts/lib/fingerprint.mjs";
import { copySample, git, tempDir, write } from "./helpers.mjs";

const fp = (dir, opts) => codeFingerprint(dir, opts)?.value;

function repo() {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	return dir;
}

test("fingerprint is null outside git and stable inside it", () => {
	assert.equal(codeFingerprint(copySample()), null);
	const dir = repo();
	assert.match(fp(dir), /^[0-9a-f]{64}$/);
	assert.equal(fp(dir), fp(dir));
});

test("code and verify.json edits change it; docs, evidence, and the skip record do not", () => {
	const dir = repo();
	const clean = fp(dir);
	write(dir, "NOTES.md", "notes\n");
	write(dir, "docs/x.txt", "doc\n");
	write(dir, ".stack-agent/evidence/latest.json", "{}");
	write(dir, ".stack-agent/verify-skip.json", "{}");
	assert.equal(fp(dir), clean);
	write(dir, ".stack-agent/verify.json", fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8") + "\n");
	const afterConfig = fp(dir);
	assert.notEqual(afterConfig, clean, "changing the checks invalidates evidence");
	write(dir, "src/new.js", "export {};\n");
	assert.notEqual(fp(dir), afterConfig, "an untracked code file counts");
});

test("evidence and the skip record never count, even when stopHookIgnore leaves .stack-agent out", () => {
	const dir = repo();
	const clean = fp(dir, { ignore: [] });
	write(dir, ".stack-agent/verify-skip.json", '{"reason":"x"}');
	write(dir, ".stack-agent/evidence/latest.json", "{}");
	assert.equal(fp(dir, { ignore: [] }), clean);
	write(dir, "out/evidence/latest.json", "{}");
	assert.equal(codeFingerprint(dir, { ignore: [], evidenceDir: "out/evidence" }).entries.has("out/evidence/latest.json"), false, "a custom evidenceDir is excluded too");
});

test("committing the change does not change the fingerprint", () => {
	const dir = repo();
	write(dir, "src/modules/items/service.js", "export const changed = true;\n");
	write(dir, "src/extra.js", "export const extra = 1;\n");
	const before = fp(dir);
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "change");
	assert.equal(fp(dir), before);
});

test("a CRLF working copy under core.autocrlf matches the committed LF blob", () => {
	const dir = repo();
	git(dir, "config", "core.autocrlf", "true");
	const clean = fp(dir);
	const file = path.join(dir, "src/modules/items/service.js");
	fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n"));
	assert.equal(fp(dir), clean);
});

test("deleting a tracked file changes it, and fingerprintDiff names the path", () => {
	const dir = repo();
	const before = codeFingerprint(dir);
	fs.rmSync(path.join(dir, "src/modules/items/repository.js"));
	const after = codeFingerprint(dir);
	assert.notEqual(after.value, before.value);
	assert.deepEqual(fingerprintDiff(before, after), ["src/modules/items/repository.js"]);
});

test("a project in a subdirectory only fingerprints its own files", () => {
	const mono = tempDir("stack-agent-mono-");
	const sample = copySample();
	fs.cpSync(sample, path.join(mono, "services", "api"), { recursive: true });
	write(mono, "README.md", "mono\n");
	git(mono, "init", "-q");
	git(mono, "add", "-A");
	git(mono, "commit", "-qm", "base");
	const root = path.join(mono, "services", "api");
	const clean = codeFingerprint(root);
	assert.ok(clean.entries.has("src/server.js"), [...clean.entries.keys()].slice(0, 5).join(","));
	write(mono, "other/tool.js", "export {};\n");
	assert.equal(codeFingerprint(root).value, clean.value, "files outside the project do not count");
	write(root, "src/server.js", "changed\n");
	assert.notEqual(codeFingerprint(root).value, clean.value);
});
