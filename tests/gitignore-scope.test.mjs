import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main as apiMap } from "../scripts/api-map.mjs";
import { main } from "../scripts/guard.mjs";
import { projectFiles } from "../scripts/lib/files.mjs";
import { copySample, git, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const guard = (dir, ...args) => main(["--root", dir, ...args]);
const KEY = "-----BEGIN PRIVATE KEY-----\nabc\n";

function keyRepo() {
	const dir = tempDir();
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ rules: [{ id: "no-private-keys", type: "pattern", files: ["**"], exclude: [".stack-agent/**"], pattern: "-----BEGIN ((RSA|EC|DSA|OPENSSH) )?PRIVATE KEY-----", message: "key", fix: "remove it" }] }));
	write(dir, ".gitignore", "secrets/\n");
	write(dir, "src/app.js", "export {};\n");
	git(dir, "init", "-q");
	return dir;
}

test("a private key in a gitignored file does not fail the guard, as in CI where the file does not exist", () => {
	const dir = keyRepo();
	write(dir, "secrets/dev.pem", KEY);
	const r = guard(dir);
	assert.equal(r.code, 0, r.text);
});

test("--update-baseline does not record gitignored files", () => {
	const dir = keyRepo();
	write(dir, "secrets/dev.pem", KEY);
	assert.equal(guard(dir, "--update-baseline").code, 0);
	const baseline = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/guard-baseline.json"), "utf8"));
	assert.deepEqual(baseline.counts, {});
});

test("an untracked file that is not gitignored is still scanned", () => {
	const dir = keyRepo();
	write(dir, "config/dev.pem", KEY);
	const r = guard(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /config\/dev\.pem:1/);
});

test("a tracked file is scanned even when a gitignore pattern matches it", () => {
	const dir = keyRepo();
	write(dir, "secrets/committed.pem", KEY);
	git(dir, "add", "-f", "secrets/committed.pem");
	const r = guard(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /secrets\/committed\.pem:1/);
});

test("--files skips a gitignored file", () => {
	const dir = keyRepo();
	write(dir, "secrets/dev.pem", KEY);
	assert.equal(guard(dir, "--files", "secrets/dev.pem").code, 0);
});

test("outside a git repo every file is scanned, as before", () => {
	const dir = keyRepo();
	fs.rmSync(path.join(dir, ".git"), { recursive: true, force: true });
	write(dir, "secrets/dev.pem", KEY);
	assert.equal(guard(dir).code, 1);
});

test("projectFiles leaves out deleted tracked files and the default ignores", () => {
	const dir = keyRepo();
	write(dir, "gone.js", "x\n");
	write(dir, "node_modules/x/index.js", "x\n");
	git(dir, "add", "-A");
	fs.rmSync(path.join(dir, "gone.js"));
	const files = projectFiles(dir);
	assert.ok(files.includes("src/app.js"));
	assert.ok(!files.includes("gone.js"));
	assert.ok(!files.some((f) => f.startsWith("node_modules/")));
});

test("a file over 1 MB is named in a warning instead of being skipped silently", () => {
	const dir = keyRepo();
	write(dir, "big.js", "x".repeat(1_100_000) + "\n" + KEY);
	const r = guard(dir);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /warning: big\.js is over 1 MB, so no rule checked it/);
});

test("the after-edit hook ignores an edit to a gitignored file", () => {
	const dir = keyRepo();
	write(dir, "secrets/dev.pem", KEY);
	const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: path.join(dir, "secrets/dev.pem") }, cwd: dir });
	const r = runNode(path.join(repoRoot, "scripts/hooks/post-edit-guard.mjs"), [], { input });
	assert.equal(r.code, 0, r.stderr);
});

test("api-map does not read routes from gitignored files", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	write(dir, ".gitignore", fs.readFileSync(path.join(dir, ".gitignore"), "utf8") + "src/scratch/\n");
	const mapConfig = path.join(dir, ".stack-agent/api-map.json");
	const config = JSON.parse(fs.readFileSync(mapConfig, "utf8"));
	config.sources[0].files = ["src/**/*.js"];
	fs.writeFileSync(mapConfig, JSON.stringify(config));
	write(dir, "src/scratch/routes.js", 'route("GET", "/scratch", h);\n');
	const r = apiMap(["--root", dir]);
	assert.equal(r.code, 0, r.text);
	assert.doesNotMatch(r.text, /scratch/);
});
