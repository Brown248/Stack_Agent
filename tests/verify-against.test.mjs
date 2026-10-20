import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { copySample, freePort, git, repoRoot, runNode, tempDir, usePort, write } from "./helpers.mjs";

const verify = path.join(repoRoot, "scripts", "verify.mjs");
const sessionStart = path.join(repoRoot, "scripts", "hooks", "session-start.mjs");
const SERVICE = "src/modules/items/service.js";
const long = (n) => "x".repeat(n);
const accept50 = { name: "create-item-accepts-50", method: "POST", path: "/items", body: { name: long(50) }, expectStatus: 201 };
const reject51 = { name: "create-item-rejects-51", method: "POST", path: "/items", body: { name: long(51) }, expectStatus: 400 };

async function repo({ gitignore = "data/\nnode_modules/\n" } = {}) {
	const dir = copySample();
	usePort(dir, await freePort());
	write(dir, ".gitignore", gitignore);
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
const addRule = (dir) => {
	const text = fs.readFileSync(path.join(dir, SERVICE), "utf8");
	write(dir, SERVICE, text.replace('if (!name) return { error: "name is required" };', 'if (!name) return { error: "name is required" };\n\tif (name.length > 50) return { error: "name is too long" };'));
};
const run = (dir, ...args) => {
	const r = runNode(verify, ["--root", dir, "--json", ...args]);
	// a failing run prints its JSON on stderr
	const record = JSON.parse(r.code === 0 ? r.stdout : r.stderr);
	return { ...r, record, against: record.steps.find((s) => s.step === "against") };
};

test("a new check that fails on the old code passes the against step", async () => {
	const dir = await repo();
	addRule(dir);
	editConfig(dir, (c) => c.checks.push(accept50, reject51));
	const r = run(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.equal(r.against.ok, true);
	assert.equal(r.against.ref, "HEAD");
	assert.deepEqual(r.against.detecting, ["create-item-rejects-51"]);
	assert.deepEqual(r.against.passingBefore, ["create-item-accepts-50"]);
	const text = runNode(verify, ["--root", dir]).stdout;
	assert.match(text, /PASS against HEAD: create-item-rejects-51 fail\(s\) on the code before the change/);
});

test("new checks that all pass on the old code fail the run", async () => {
	const dir = await repo();
	addRule(dir);
	editConfig(dir, (c) => c.checks.push(accept50));
	const r = run(dir);
	assert.equal(r.code, 1);
	assert.equal(r.record.ok, false);
	assert.match(r.against.problems[0], /create-item-accepts-50 also pass on the code before your change \(HEAD\), so they do not test it/);
});

test("the against step is skipped when only checks changed, not code", async () => {
	const dir = await repo();
	editConfig(dir, (c) => c.checks.push(accept50));
	const r = run(dir);
	assert.equal(r.code, 0, r.stdout);
	assert.equal(r.against.skipped, "only checks or tests changed, no code");
});

test("renaming a check or changing its timeout is not a new check, and removed checks are listed", async () => {
	const dir = await repo();
	addRule(dir);
	editConfig(dir, (c) => {
		c.checks[0].name = "health-renamed";
		c.checks[1].timeoutSec = 30;
		c.checks.splice(3, 1);
	});
	const r = run(dir);
	assert.equal(r.code, 0, r.stdout);
	assert.equal(r.against.skipped, "no new or changed checks");
	assert.deepEqual(r.against.removed, ["create-item-rejects-empty"]);
});

test("skipped outside git, without verify.json at the ref, and with --no-against or against: false", async () => {
	const plain = copySample();
	usePort(plain, await freePort());
	assert.equal(run(plain).against.skipped, "not a git repository");

	const dir = await repo();
	git(dir, "rm", "-q", "--cached", ".stack-agent/verify.json");
	git(dir, "commit", "-qm", "drop config");
	addRule(dir);
	editConfig(dir, (c) => c.checks.push(reject51));
	assert.match(run(dir).against.skipped, /verify\.json does not exist at HEAD/);

	const off = await repo();
	addRule(off);
	editConfig(off, (c) => c.checks.push(accept50));
	assert.equal(run(off, "--no-against").against, undefined);
	editConfig(off, (c) => (c.against = false));
	assert.equal(run(off).against, undefined);
	assert.equal(runNode(verify, ["--root", off, "--check", "health"]).stdout.includes("against"), false, "partial runs never compare");
});

test("committing mid-task still compares with the HEAD the session started from", async () => {
	const dir = await repo();
	runNode(sessionStart, [], { input: JSON.stringify({ cwd: dir, session_id: "s1" }) });
	const start = git(dir, "rev-parse", "HEAD").trim();
	addRule(dir);
	editConfig(dir, (c) => c.checks.push(accept50));
	git(dir, "commit", "-qam", "change");
	const r = run(dir);
	assert.equal(r.code, 1, r.stdout);
	assert.equal(r.against.ref, start);
});

test("the old code's server failing to start is inconclusive, unless against.required", async () => {
	const dir = await repo();
	write(dir, "src/server2.js", fs.readFileSync(path.join(dir, "src/server.js"), "utf8"));
	editConfig(dir, (c) => {
		c.server.command = c.server.command.replace("src/server.js", "src/server2.js");
		c.checks.push(accept50);
	});
	const r = run(dir);
	assert.equal(r.code, 0, r.stdout);
	assert.match(r.against.skipped, /the server did not start on the code at HEAD.*\(inconclusive\)/);
	editConfig(dir, (c) => (c.against = { required: true }));
	assert.equal(run(dir).code, 1);
});

test("the real node_modules survives and no worktree or temp dir is left behind", async () => {
	const dir = await repo();
	write(dir, "node_modules/some-dep/sentinel.txt", "keep me\n");
	const tmp = tempDir("stack-agent-against-tmp-");
	addRule(dir);
	editConfig(dir, (c) => {
		c.checks.push(reject51);
		c.against = { tmpDir: tmp };
	});
	const r = run(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.equal(fs.readFileSync(path.join(dir, "node_modules/some-dep/sentinel.txt"), "utf8"), "keep me\n");
	assert.deepEqual(fs.readdirSync(tmp), []);
	assert.equal(git(dir, "worktree", "list").trim().split("\n").length, 1);
});

test("a check that runs a new test file gets that file on the old code too", async () => {
	const dir = await repo();
	addRule(dir);
	write(dir, "test/long-name.test.js", 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { createItem } from "../src/modules/items/service.js";\ntest("long", () => assert.ok(createItem({ name: "x".repeat(51) }).error));\n');
	editConfig(dir, (c) => c.checks.push({ name: "long-name-test", args: [process.execPath, "--test", "test/long-name.test.js"] }));
	const r = run(dir);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.deepEqual(r.against.detecting, ["long-name-test"], "it fails on old code because the rule is missing, not because the file is");
});
