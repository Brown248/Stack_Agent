import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadConfig } from "../scripts/guard.mjs";
import { listPresets } from "../scripts/init.mjs";
import { loadVerifyConfig } from "../scripts/verify.mjs";
import { repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const initScript = path.join(repoRoot, "scripts", "init.mjs");
const presetDir = (p) => path.join(repoRoot, "templates", "presets", p);

test("the expected presets exist", () => {
	assert.deepEqual(listPresets(), ["backend-http", "cli", "frontend-web", "generic", "library"]);
});

test("every preset ships a guard config and a verify config that load without errors", () => {
	for (const preset of listPresets()) {
		assert.doesNotThrow(() => loadConfig(path.join(presetDir(preset), "guard.config.json")), preset);
		assert.doesNotThrow(() => loadVerifyConfig(path.join(presetDir(preset), "verify.json")), preset);
	}
});

test("every preset keeps the universal rules", () => {
	for (const preset of listPresets()) {
		const ids = loadConfig(path.join(presetDir(preset), "guard.config.json")).rules.map((r) => r.id);
		assert.ok(ids.includes("no-merge-conflict-markers") && ids.includes("no-private-keys"), preset);
	}
});

test("init --preset installs that preset's files, and only backend-http gets an API map", () => {
	for (const preset of listPresets()) {
		const dir = tempDir("stack-agent-preset-");
		const r = runNode(initScript, [dir, "--preset", preset]);
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, new RegExp(`preset: ${preset}`));
		assert.equal(fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8"), fs.readFileSync(path.join(presetDir(preset), "verify.json"), "utf8"));
		assert.equal(fs.existsSync(path.join(dir, ".stack-agent/api-map.json")), preset === "backend-http", preset);
		const check = runNode(initScript, [dir, "--check"]);
		assert.equal(check.code, 1, preset);
		assert.equal(/api-map\.md: missing/.test(check.stdout), preset === "backend-http", preset);
	}
});

test("init without --preset uses generic, and an unknown preset is a usage error", () => {
	const dir = tempDir("stack-agent-preset-");
	assert.match(runNode(initScript, [dir]).stdout, /preset: generic/);
	const bad = runNode(initScript, [tempDir("stack-agent-preset-"), "--preset", "mainframe"]);
	assert.equal(bad.code, 2);
	assert.match(bad.stderr, /unknown preset "mainframe"; choose one of: backend-http, cli, frontend-web, generic, library/);
});

test("the universal rules catch conflict markers and private keys, but not the config that defines them", async () => {
	const { main } = await import("../scripts/guard.mjs");
	const dir = tempDir("stack-agent-preset-");
	runNode(initScript, [dir, "--preset", "cli"]);
	const config = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/guard.config.json"), "utf8"));
	config.rules = config.rules.filter((r) => !r.id.startsWith("edit-me"));
	fs.writeFileSync(path.join(dir, ".stack-agent/guard.config.json"), JSON.stringify(config));
	assert.equal(main(["--root", dir]).code, 0);
	write(dir, "src/app.py", "a = 1\n<<<<<<< HEAD\nb = 2\n=======\nb = 3\n>>>>>>> feature\n");
	write(dir, "deploy/key.pem", "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n");
	const r = main(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /src\/app\.py:2 {2}\[no-merge-conflict-markers\]/);
	assert.match(r.text, /deploy\/key\.pem:1 {2}\[no-private-keys\]/);
});

test("every preset carries no-debug-tags, which catches tagged debug lines in code but not in docs", async () => {
	const { main } = await import("../scripts/guard.mjs");
	for (const preset of listPresets()) assert.ok(loadConfig(path.join(presetDir(preset), "guard.config.json")).rules.some((r) => r.id === "no-debug-tags"), preset);
	const dir = tempDir("stack-agent-preset-");
	runNode(initScript, [dir, "--preset", "cli"]);
	const config = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/guard.config.json"), "utf8"));
	config.rules = config.rules.filter((r) => !r.id.startsWith("edit-me"));
	fs.writeFileSync(path.join(dir, ".stack-agent/guard.config.json"), JSON.stringify(config));
	write(dir, "docs/debugging.md", "Tag lines like [DEBUG-a4f2] while you debug.\n");
	write(dir, "src/app.py", "print('ok')\n");
	assert.equal(main(["--root", dir]).code, 0);
	write(dir, "src/app.py", "print('ok')\nprint('[DEBUG-a4f2] total', total)\n");
	// mid-task the after-edit hook lets the tagged line through; the guard itself fails on it
	const hook = runNode(path.join(repoRoot, "scripts", "hooks", "post-edit-guard.mjs"), [], { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: path.join(dir, "src/app.py") } }) });
	assert.equal(hook.code, 0, hook.stderr);
	write(dir, "logs/run.log", "[DEBUG-a4f2] total 3\n");
	write(dir, "dist/app.js", "console.log('[DEBUG-a4f2]')\n");
	const r = main(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /src\/app\.py:2 {2}\[no-debug-tags\]/);
	assert.doesNotMatch(r.text, /docs\/debugging\.md|logs\/run\.log|dist\/app\.js/);
});

test("onEdit accepts only skip, and a rule without it still blocks in the after-edit hook", () => {
	const dir = tempDir("stack-agent-preset-");
	const rule = { id: "no-todo", type: "pattern", files: ["**"], pattern: "TODO-NOW", message: "m", fix: "f" };
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ rules: [{ ...rule, onEdit: "warn" }] }));
	assert.throws(() => loadConfig(path.join(dir, ".stack-agent/guard.config.json")), /onEdit can only be "skip"/);
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ rules: [rule] }));
	write(dir, "a.txt", "TODO-NOW\n");
	const hook = runNode(path.join(repoRoot, "scripts", "hooks", "post-edit-guard.mjs"), [], { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path: path.join(dir, "a.txt") } }) });
	assert.equal(hook.code, 2);
	assert.match(hook.stderr, /\[no-todo\]/);
});
