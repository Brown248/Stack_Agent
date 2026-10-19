import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { copySample, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const initScript = path.join(repoRoot, "scripts", "init.mjs");
const emptyDir = () => tempDir("stack-agent-init-");

test("init copies tools and templates, and is safe to rerun", () => {
	const dir = emptyDir();
	const first = runNode(initScript, [dir]);
	assert.equal(first.code, 0, first.stderr);
	for (const f of [".stack-agent/bin/guard.mjs", ".stack-agent/bin/verify.mjs", ".stack-agent/bin/api-map.mjs", ".stack-agent/bin/lib/files.mjs", ".stack-agent/guard.config.json", ".github/workflows/stack-agent.yml"]) {
		assert.ok(fs.existsSync(path.join(dir, f)), f);
	}
	assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), ".stack-agent/evidence/\n");
	const second = runNode(initScript, [dir]);
	assert.match(second.stdout, /unchanged \.stack-agent\/bin\/guard\.mjs/);
	assert.match(second.stdout, /kept {5}\.stack-agent\/verify\.json/);
	assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), ".stack-agent/evidence/\n", "gitignore line must not repeat");
});

test("init never overwrites an existing config and appends to an existing .gitignore", () => {
	const dir = emptyDir();
	write(dir, ".stack-agent/verify.json", '{"mine":true}');
	write(dir, ".gitignore", "node_modules");
	runNode(initScript, [dir]);
	assert.equal(fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8"), '{"mine":true}');
	assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), "node_modules\n.stack-agent/evidence/\n");
});

test("init refreshes an outdated vendored tool", () => {
	const dir = emptyDir();
	runNode(initScript, [dir]);
	write(dir, ".stack-agent/bin/guard.mjs", "// old\n");
	assert.match(runNode(initScript, [dir]).stdout, /updated {3}\.stack-agent\/bin\/guard\.mjs/);
	assert.equal(fs.readFileSync(path.join(dir, ".stack-agent/bin/guard.mjs"), "utf8"), fs.readFileSync(path.join(repoRoot, "scripts/guard.mjs"), "utf8"));
});

test("--check exits 1 while placeholders remain and 0 on a finished setup", () => {
	const fresh = emptyDir();
	runNode(initScript, [fresh]);
	const pending = runNode(initScript, [fresh, "--check"]);
	assert.equal(pending.code, 1);
	assert.match(pending.stdout, /verify\.json: still has EDIT ME placeholders/);

	const sample = copySample();
	runNode(initScript, [sample]);
	const done = runNode(initScript, [sample, "--check"]);
	assert.equal(done.code, 0, done.stdout);
	assert.match(done.stdout, /setup complete/);
});

test("init stamps .stack-agent/bin/VERSION with the plugin version", () => {
	const dir = emptyDir();
	assert.match(runNode(initScript, [dir]).stdout, /created {3}\.stack-agent\/bin\/VERSION/);
	const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin/plugin.json"), "utf8"));
	assert.equal(fs.readFileSync(path.join(dir, ".stack-agent/bin/VERSION"), "utf8"), version + "\n");
	assert.match(runNode(initScript, [dir]).stdout, /unchanged \.stack-agent\/bin\/VERSION/);
});

test("--check reports vendored tools that differ from the plugin, and rerunning init fixes them", () => {
	const fresh = emptyDir();
	runNode(initScript, [fresh]);
	assert.doesNotMatch(runNode(initScript, [fresh, "--check"]).stdout, /outdated|refresh it/, "a fresh init has nothing outdated");

	const sample = copySample();
	runNode(initScript, [sample]);
	write(sample, ".stack-agent/bin/guard.mjs", "// old guard\n");
	write(sample, ".stack-agent/bin/VERSION", "0.0.1\n");
	fs.rmSync(path.join(sample, ".stack-agent/bin/lib/files.mjs"));
	const stale = runNode(initScript, [sample, "--check"]);
	assert.equal(stale.code, 1, stale.stdout);
	assert.match(stale.stdout, /outdated: \.stack-agent\/bin\/guard\.mjs\n/);
	assert.match(stale.stdout, /outdated: \.stack-agent\/bin\/VERSION\n/);
	assert.match(stale.stdout, /outdated: \.stack-agent\/bin\/lib\/files\.mjs \(missing\)/);
	assert.doesNotMatch(stale.stdout, /outdated: \.stack-agent\/bin\/(verify|api-map)\.mjs/);
	assert.match(stale.stdout, /refresh it with `node \S*scripts\/init\.mjs /);
	assert.equal(fs.readFileSync(path.join(sample, ".stack-agent/bin/guard.mjs"), "utf8"), "// old guard\n", "--check must not write");

	runNode(initScript, [sample]);
	const fixed = runNode(initScript, [sample, "--check"]);
	assert.equal(fixed.code, 0, fixed.stdout);
	assert.doesNotMatch(fixed.stdout, /outdated/);
});

test("the vendored tools work from the target repo", () => {
	const sample = copySample();
	runNode(initScript, [sample]);
	const r = runNode(path.join(sample, ".stack-agent/bin/guard.mjs"), [], { cwd: sample });
	assert.equal(r.code, 0, r.stderr);
	const m = runNode(path.join(sample, ".stack-agent/bin/api-map.mjs"), [], { cwd: sample });
	assert.equal(m.code, 0, m.stderr);
});

test("init refuses the plugin repo itself and bad arguments", () => {
	assert.equal(runNode(initScript, [repoRoot]).code, 2);
	assert.equal(runNode(initScript, [path.join(repoRoot, "does-not-exist")]).code, 2);
	assert.equal(runNode(initScript, ["a", "b"]).code, 2);
});
