// Regression tests for the review of the fingerprint, blocking Stop hook, and against step.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { copySample, freePort, git, repoRoot, runNode, tempDir, usePort, write } from "./helpers.mjs";

const hook = (name) => path.join(repoRoot, "scripts", "hooks", name);
const verify = path.join(repoRoot, "scripts", "verify.mjs");
const stop = (dir, extra = {}) => runNode(hook("stop-verify.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "r3", ...extra }) });
const sessionStart = (dir) => runNode(hook("session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "r3" }) });
const touch = (dir, rel, text = "\n") => write(dir, rel, fs.readFileSync(path.join(dir, rel), "utf8") + text);
const SERVICE = "src/modules/items/service.js";
const accept50 = { name: "create-item-accepts-50", method: "POST", path: "/items", body: { name: "x".repeat(50) }, expectStatus: 201 };

async function repo() {
	const dir = copySample();
	usePort(dir, await freePort());
	write(dir, ".gitignore", "data/\nnode_modules/\n");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	return dir;
}
const editConfig = (dir, fn) => {
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	fn(config);
	fs.writeFileSync(file, JSON.stringify(config, null, 2));
};
const addRule = (dir) =>
	write(dir, SERVICE, fs.readFileSync(path.join(dir, SERVICE), "utf8").replace('if (!name) return { error: "name is required" };', 'if (!name) return { error: "name is required" };\n\tif (name.length > 50) return { error: "name is too long" };'));
const record = (r) => JSON.parse(r.code === 0 ? r.stdout : r.stderr);
const against = (r) => record(r).steps.find((s) => s.step === "against");

test("committing the work does not get past the block", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, SERVICE);
	assert.equal(stop(dir).code, 2);
	git(dir, "commit", "-qam", "work");
	const r = stop(dir);
	assert.equal(r.code, 2, "the code still differs from the session start");
	assert.match(r.stderr, /changes committed since the session started/);
});

test("editing stopHook or stopHookIgnore mid-session does not switch the hook off", async () => {
	const dir = await repo();
	sessionStart(dir);
	editConfig(dir, (c) => {
		c.stopHook = "remind";
		c.stopHookIgnore = ["**"];
	});
	touch(dir, SERVICE);
	const r = stop(dir);
	assert.equal(r.code, 2, r.stderr);
	assert.match(r.stderr, /Stop 1 of 3/, "still block mode");
});

test("files the human left dirty before the session are not listed as the agent's", async () => {
	const dir = await repo();
	touch(dir, "src/app.js");
	sessionStart(dir);
	touch(dir, SERVICE);
	const r = stop(dir);
	assert.equal(r.code, 2);
	assert.match(r.stderr, /src\/modules\/items\/service\.js/);
	assert.doesNotMatch(r.stderr, /src\/app\.js/);
});

test("evidence from a run with the against step turned off is refused unless the session started that way", async () => {
	const dir = await repo();
	sessionStart(dir);
	addRule(dir);
	editConfig(dir, (c) => c.checks.push(accept50));
	assert.equal(runNode(verify, ["--root", dir]).code, 1, "the weak check fails the against step");
	const off = runNode(verify, ["--root", dir, "--no-against", "--json"]);
	assert.equal(off.code, 0);
	assert.equal(record(off).against, "off");
	const r = stop(dir);
	assert.equal(r.code, 2);
	assert.match(r.stderr, /turned the against step off/);

	const offFromStart = await repo();
	editConfig(offFromStart, (c) => (c.against = false));
	git(offFromStart, "commit", "-qam", "against off");
	sessionStart(offFromStart);
	touch(offFromStart, SERVICE);
	assert.equal(runNode(verify, ["--root", offFromStart]).code, 0);
	assert.equal(stop(offFromStart).code, 0, "a project that has the step off is not blocked for it");
});

test("a run that changes files itself is not accepted, and the hook names the files", async () => {
	const dir = await repo();
	editConfig(dir, (c) => (c.against = false));
	git(dir, "commit", "-qam", "against off");
	sessionStart(dir);
	touch(dir, SERVICE);
	editConfig(dir, (c) => c.checks.push({ name: "writes-a-file", args: [process.execPath, "-e", "require('fs').writeFileSync('out-' + Date.now() + '.txt', 'x')"] }));
	const run = runNode(verify, ["--root", dir]);
	assert.match(run.stdout + run.stderr, /this run changed out-\d+\.txt/);
	const r = stop(dir);
	assert.equal(r.code, 2);
	assert.match(r.stderr, /the verify run itself changed out-\d+\.txt/);
});

test("a missing module or program on the old checkout is inconclusive, not detection", async () => {
	const dir = await repo();
	write(dir, "src/new-cli.js", 'console.log("new");\n');
	editConfig(dir, (c) => c.checks.push({ name: "new-cli", args: [process.execPath, "src/new-cli.js"], expectOutputIncludes: "new" }));
	const r = runNode(verify, ["--root", dir, "--json"]);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.match(against(r).skipped, /every new check was inconclusive/);
	assert.deepEqual(against(r).inconclusive, ["new-cli"]);
});

test("with against.setup, node_modules is not linked unless asked", async () => {
	const dir = await repo();
	write(dir, "node_modules/dep/sentinel.txt", "keep\n");
	addRule(dir);
	editConfig(dir, (c) => {
		c.checks.push({ name: "create-item-rejects-51", method: "POST", path: "/items", body: { name: "x".repeat(51) }, expectStatus: 400 });
		c.against = { setup: { args: [process.execPath, "-e", "process.exit(require('fs').existsSync('node_modules') ? 1 : 0)"] } };
	});
	const r = runNode(verify, ["--root", dir, "--json"]);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.equal(against(r).ok, true);
	assert.deepEqual(against(r).detecting, ["create-item-rejects-51"], "setup saw no node_modules link and the step ran");
	assert.equal(fs.readFileSync(path.join(dir, "node_modules/dep/sentinel.txt"), "utf8"), "keep\n");
});

test("against and stopHookIgnore settings are validated", async () => {
	const dir = await repo();
	for (const bad of [{ against: { keep: "tests/**" } }, { against: { link: "node_modules" } }, { against: { tmpDir: 3 } }, { against: { required: "yes" } }, { stopHookIgnore: "**/*.md" }, { stopHook: "off" }]) {
		editConfig(dir, (c) => {
			delete c.against;
			delete c.stopHookIgnore;
			delete c.stopHook;
			Object.assign(c, bad);
		});
		assert.equal(runNode(verify, ["--root", dir]).code, 2, JSON.stringify(bad));
	}
});

test("a string stopHookIgnore does not crash the Stop hook", async () => {
	const dir = await repo();
	editConfig(dir, (c) => (c.stopHookIgnore = "**/*.md"));
	touch(dir, SERVICE);
	const r = stop(dir);
	assert.equal(r.code, 2, r.stderr);
	assert.match(r.stderr, /stack-agent: code changed/);
});

test("Edit/Write on the Stop hook's session record asks a human", () => {
	const r = runNode(hook("pre-edit-protect.mjs"), [], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: "/p/.stack-agent/evidence/sessions/abc.json" } }) });
	assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "ask");
});

test("session records older than a week are removed at session start", async () => {
	const dir = await repo();
	const old = path.join(dir, ".stack-agent/evidence/sessions/old.json");
	write(dir, ".stack-agent/evidence/sessions/old.json", "{}");
	const past = new Date(Date.now() - 8 * 24 * 3600_000);
	fs.utimesSync(old, past, past);
	sessionStart(dir);
	assert.equal(fs.existsSync(old), false);
	assert.equal(fs.existsSync(path.join(dir, ".stack-agent/evidence/sessions/r3.start.json")), true);
});

test("with two sessions, the against step compares with the earlier start", async () => {
	const dir = await repo();
	const first = git(dir, "rev-parse", "HEAD").trim();
	sessionStart(dir);
	addRule(dir);
	editConfig(dir, (c) => c.checks.push(accept50));
	git(dir, "commit", "-qam", "session A work");
	runNode(hook("session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "later" }) });
	const r = runNode(verify, ["--root", dir, "--json"]);
	assert.equal(against(r).ref, first);
	assert.equal(r.code, 1, "session A's weak check is still caught");
	void tempDir;
});

// second review round
test("evidence made with a different stopHookIgnore than the session started with is refused with a clear reason", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, SERVICE);
	editConfig(dir, (c) => {
		c.stopHookIgnore = ["**/*.md", ".stack-agent/**", "docs/**", "fixtures/**"];
		c.against = false;
	});
	assert.equal(runNode(verify, ["--root", dir]).code, 0);
	const r = stop(dir);
	assert.equal(r.code, 2);
	assert.match(r.stderr, /different stopHookIgnore than this session started with/);
});

test("without a session record, a project with against: false is not blocked for it", async () => {
	const dir = await repo();
	editConfig(dir, (c) => (c.against = false));
	git(dir, "commit", "-qam", "against off");
	touch(dir, SERVICE);
	assert.equal(runNode(verify, ["--root", dir]).code, 0);
	assert.equal(stop(dir).code, 0);
});

test("deleting the sessions folder or the evidence folder from the shell asks a human", () => {
	for (const command of ["rm -rf .stack-agent/evidence/sessions", "rm -rf .stack-agent/evidence", "Remove-Item -Recurse .stack-agent"]) {
		const r = runNode(hook("pre-bash.mjs"), [], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }) });
		assert.equal(r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : undefined, "ask", command);
	}
});

test("a session that started more than three days ago is not used as the against reference", async () => {
	const dir = await repo();
	sessionStart(dir);
	const file = path.join(dir, ".stack-agent/evidence/sessions/r3.start.json");
	const rec = JSON.parse(fs.readFileSync(file, "utf8"));
	fs.writeFileSync(file, JSON.stringify({ ...rec, at: new Date(Date.now() - 4 * 24 * 3600_000).toISOString() }));
	addRule(dir);
	editConfig(dir, (c) => c.checks.push(accept50));
	git(dir, "commit", "-qam", "work");
	const r = runNode(verify, ["--root", dir, "--json"]);
	assert.equal(against(r).ref, "HEAD");
});
