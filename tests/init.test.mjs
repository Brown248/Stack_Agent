import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { copyExample, copySample, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

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

test("the CI workflow template runs verify in CI, with fetch-depth 0 and --against on pull requests", () => {
	const text = fs.readFileSync(path.join(repoRoot, "templates/ci/stack-agent.yml"), "utf8");
	const job = text.slice(text.search(/^ {2}verify:/m));
	assert.ok(job.length < text.length, "verify job missing");
	assert.match(job, /fetch-depth: 0/);
	assert.match(job, /if: github\.event_name == 'pull_request'\n\s+run: node \.stack-agent\/bin\/verify\.mjs --against "origin\/\$\{\{ github\.base_ref \}\}"/);
	assert.match(job, /if: github\.event_name != 'pull_request'\n\s+run: node \.stack-agent\/bin\/verify\.mjs\n/);
	assert.match(job, /if: always\(\)\n\s+uses: actions\/upload-artifact@v4[\s\S]*path: \.stack-agent\/evidence\//);
	assert.match(job, /EDIT ME: install your dependencies/);
	assert.doesNotMatch(job, /continue-on-error/);
});

test("--check reports the workflow's EDIT ME install step on a fresh init, and examples ship it filled", () => {
	const fresh = emptyDir();
	runNode(initScript, [fresh]);
	assert.match(runNode(initScript, [fresh, "--check"]).stdout, /\.github\/workflows\/stack-agent\.yml: still has EDIT ME placeholders/);
	for (const name of fs.readdirSync(path.join(repoRoot, "examples"))) {
		const wf = fs.readFileSync(path.join(repoRoot, "examples", name, ".github/workflows/stack-agent.yml"), "utf8");
		assert.doesNotMatch(wf, /EDIT ME/, name);
		assert.match(wf, /verify\.mjs --against/, name);
	}
});

test("--check notes a rule every preset ships that the guard config lacks, without changing the exit code", async () => {
	const { universalRules } = await import("../scripts/init.mjs");
	assert.deepEqual(universalRules(), ["no-merge-conflict-markers", "no-private-keys", "no-debug-tags"]);
	const dir = emptyDir();
	runNode(initScript, [dir, "--preset", "cli"]);
	const before = runNode(initScript, [dir, "--check"]);
	assert.doesNotMatch(before.stdout, /notes/);
	const file = path.join(dir, ".stack-agent/guard.config.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	fs.writeFileSync(file, JSON.stringify({ ...config, rules: config.rules.filter((r) => r.id !== "no-debug-tags") }));
	const after = runNode(initScript, [dir, "--check"]);
	assert.equal(after.code, before.code);
	assert.match(after.stdout, /guard rule no-debug-tags is in every preset but not in \.stack-agent\/guard\.config\.json; copy the rule from .*templates\/presets\/cli\/guard\.config\.json into it, or add "no-debug-tags" to "declinedRules" in your \.stack-agent\/guard\.config\.json/);
	// a plain rerun says the same, since init never rewrites the config
	assert.match(runNode(initScript, [dir]).stdout, /guard rule no-debug-tags is in every preset/);
	// declining it on purpose silences the note
	fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), declinedRules: ["no-debug-tags"] }));
	assert.doesNotMatch(runNode(initScript, [dir, "--check"]).stdout, /no-debug-tags/);
});

test("declinedRules must be a list of rule ids, and every example carries the universal rules", async () => {
	const { loadConfig } = await import("../scripts/guard.mjs");
	const { missingRules } = await import("../scripts/init.mjs");
	const dir = emptyDir();
	write(dir, "g.json", JSON.stringify({ declinedRules: "no-debug-tags", rules: [{ id: "a", type: "pattern", files: ["**"], pattern: "x", message: "m", fix: "f" }] }));
	assert.throws(() => loadConfig(path.join(dir, "g.json")), /declinedRules/);
	for (const ex of fs.readdirSync(path.join(repoRoot, "examples")))
		if (fs.existsSync(path.join(repoRoot, "examples", ex, ".stack-agent/guard.config.json"))) assert.deepEqual(missingRules(path.join(repoRoot, "examples", ex)), [], ex);
});

test("a missing universal rule leaves a finished setup finished (exit 0), and malformed configs get no notes", () => {
	const dir = copyExample("sample-generic");
	runNode(initScript, [dir]);
	const done = runNode(initScript, [dir, "--check"]);
	assert.equal(done.code, 0, done.stdout);
	const file = path.join(dir, ".stack-agent/guard.config.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	fs.writeFileSync(file, JSON.stringify({ ...config, rules: config.rules.filter((r) => r.id !== "no-private-keys") }));
	const noted = runNode(initScript, [dir, "--check"]);
	assert.equal(noted.code, 0, noted.stdout);
	assert.match(noted.stdout, /setup complete/);
	assert.match(noted.stdout, /guard rule no-private-keys is in every preset/);
	for (const text of ["null", "[]", "{not json", JSON.stringify({ rules: {} }), '"x"']) {
		fs.writeFileSync(file, text);
		const r = runNode(initScript, [dir, "--check"]);
		assert.ok(r.code === 0 || r.code === 1, `${text}: ${r.stderr}`);
		assert.doesNotMatch(r.stdout + r.stderr, /notes|TypeError/, text);
	}
	fs.rmSync(file);
	assert.doesNotMatch(runNode(initScript, [dir, "--check"]).stdout, /notes/);
});
