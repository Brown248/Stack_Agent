// verify behaviors that had no test of their own: config errors, the 8 MB output cap, HTTP failure modes, the against
// step's skip reasons and options, and the small messages.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main } from "../scripts/verify.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { freePort, git, tempDir, write } from "./helpers.mjs";

const node = process.execPath;

function project(config, files = {}) {
	const dir = tempDir("stack-agent-vcov-");
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	write(dir, ".stack-agent/verify.json", JSON.stringify(config));
	return dir;
}

function repo(config, files = {}) {
	const dir = project(config, files);
	write(dir, ".gitignore", ".stack-agent/evidence/\n");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	return dir;
}

const setConfig = (dir, config) => write(dir, ".stack-agent/verify.json", JSON.stringify(config));
const rejects = (dir, args, re) => assert.rejects(main(["--root", dir, ...args]), (e) => e instanceof ConfigError && re.test(e.message), String(re));

// a program whose output is "small" until it changes, and a check that asserts the new output
const sayOld = { "say.cjs": 'console.log("small");\n' };
const sayNew = 'console.log("big");\n';
const bigCheck = { name: "says-big", args: [node, "say.cjs"], expectOutputIncludes: "big" };

test("config errors name the check and what it lacks", async () => {
	for (const [checks, re, extra] of [
		[[{ args: [node, "-v"] }], /check "\?" needs a name/],
		[[{ name: "a", args: [node, "-v"] }, { name: "a", args: [node, "-v"] }], /duplicate check name a/],
		[[{ name: "h", method: "GET", path: "/" }], /check "h": http checks need method, path, expectStatus/, { baseUrl: "http://127.0.0.1:9" }],
		[[{ name: "h", path: "/", expectStatus: 200 }], /http checks need method, path, expectStatus/, { baseUrl: "http://127.0.0.1:9" }],
		[[{ name: "h", method: "GET", path: "/", expectStatus: 200 }], /needs baseUrl when it has http checks/],
		[[{ name: "t", type: "ftp", path: "/" }], /type must be one of http, command/],
	])
		await rejects(project({ checks, ...extra }), [], re);
});

test("output over 8 MB (9 MB here, which used to pass) fails the check and says to make the command quieter", async () => {
	const noisy = "process.stdout.write('HEAD-MARK\\n'); const line = 'x'.repeat(1023) + '\\n'; for (let i = 0; i < 9 * 1024; i++) process.stdout.write(line); process.stdout.write('TAIL-MARK\\n');";
	const dir = project({ checks: [{ name: "noisy", args: [node, "-e", noisy], expectOutputIncludes: "HEAD-MARK", timeoutSec: 60 }] });
	const r = await main(["--root", dir]);
	assert.equal(r.code, 1, r.text);
	assert.match(r.text, /output was over 8 MB, so the middle was dropped before matching; make the command quieter/);
	const step = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8")).steps[0];
	assert.equal(step.truncated, true);
	assert.match(step.output, /TAIL-MARK/, "the end is kept");
});

test("an HTTP check whose body is not JSON fails plainly; one that gets no answer is inconclusive", async () => {
	const port = await freePort();
	const server = `require("http").createServer((q, s) => s.end("plain text")).listen(${port}, "127.0.0.1");\n`;
	const dir = project(
		{
			server: { args: [node, "server.cjs"], readyUrl: `http://127.0.0.1:${port}/` },
			baseUrl: `http://127.0.0.1:${port}`,
			checks: [{ name: "json", method: "GET", path: "/", expectStatus: 200, expectJson: { ok: true } }],
		},
		{ "server.cjs": server },
	);
	const r = await main(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /FAIL check json: GET \/ -> 200 \(body is not JSON\)/);

	const closed = await freePort();
	const gone = project({ baseUrl: `http://127.0.0.1:${closed}`, checks: [{ name: "down", method: "GET", path: "/", expectStatus: 200, timeoutSec: 2 }] });
	const g = await main(["--root", gone]);
	assert.equal(g.code, 1);
	assert.match(g.text, /FAIL check down: GET \/ -> no response \(request failed: /);
	const step = JSON.parse(fs.readFileSync(path.join(gone, ".stack-agent/evidence/latest.json"), "utf8")).steps[0];
	assert.equal(step.inconclusive, true);
});

test("the against step skips with a reason when it has nothing to compare with", async () => {
	// a repository with no commit yet
	const fresh = project({ checks: [bigCheck] }, { "say.cjs": sayNew });
	git(fresh, "init", "-q");
	assert.match((await main(["--root", fresh])).text, /SKIP against: no commit to compare with yet/);

	// verify.json did not exist at the base commit
	const noConfig = tempDir("stack-agent-vcov-");
	write(noConfig, "say.cjs", sayOld["say.cjs"]);
	git(noConfig, "init", "-q");
	git(noConfig, "add", "-A");
	git(noConfig, "commit", "-qm", "base");
	write(noConfig, "say.cjs", sayNew);
	setConfig(noConfig, { checks: [bigCheck] });
	assert.match((await main(["--root", noConfig])).text, /SKIP against: \.stack-agent\/verify\.json does not exist at HEAD/);

	// verify.json at the base commit is not JSON
	const broken = tempDir("stack-agent-vcov-");
	write(broken, "say.cjs", sayOld["say.cjs"]);
	write(broken, ".stack-agent/verify.json", "{ not json");
	git(broken, "init", "-q");
	git(broken, "add", "-A");
	git(broken, "commit", "-qm", "base");
	write(broken, "say.cjs", sayNew);
	setConfig(broken, { checks: [bigCheck] });
	assert.match((await main(["--root", broken])).text, /SKIP against: \.stack-agent\/verify\.json at HEAD is not valid JSON/);

	await rejects(broken, ["--against", "no-such-ref"], /--against: no-such-ref is not a commit in this repo/);
});

test("a failing against.setup skips the step, or fails the run when against.required is set", async () => {
	const failSetup = { args: [node, "-e", "console.error('install broke'); process.exit(3)"] };
	for (const required of [false, true]) {
		const dir = repo({ checks: [{ name: "small", args: [node, "say.cjs"] }], against: { setup: failSetup, required } }, sayOld);
		write(dir, "say.cjs", sayNew);
		setConfig(dir, { checks: [{ name: "small", args: [node, "say.cjs"] }, bigCheck], against: { setup: failSetup, required } });
		const r = await main(["--root", dir]);
		if (required) {
			assert.equal(r.code, 1, r.text);
			assert.match(r.text, /FAIL against HEAD: against\.setup failed on HEAD: [\s\S]*install broke[\s\S]*against\.required is set, so this fails the run/);
		} else {
			assert.equal(r.code, 0, r.text);
			assert.match(r.text, /SKIP against: against\.setup failed on HEAD: [\s\S]*install broke[\s\S]*\(inconclusive\)/);
		}
	}
});

test("against.keep replaces the default test globs that travel to the old code", async () => {
	// the new check runs a spec file in checks/, which only travels to the old code when keep names it
	const files = { ...sayOld, "checks/big.cjs": 'const out = require("child_process").execFileSync(process.execPath, ["say.cjs"]).toString(); if (!out.includes("big")) process.exit(1);\n' };
	const config = (keep) => ({ checks: [{ name: "spec", args: [node, "checks/big.cjs"] }], ...(keep && { against: { keep } }) });
	const plain = repo({ checks: [{ name: "small", args: [node, "say.cjs"] }] }, sayOld);
	const kept = repo({ checks: [{ name: "small", args: [node, "say.cjs"] }] }, sayOld);
	for (const [dir, keep] of [[plain, null], [kept, ["checks/**"]]]) {
		for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
		write(dir, "say.cjs", sayNew);
		setConfig(dir, { ...config(keep), checks: [{ name: "small", args: [node, "say.cjs"] }, ...config(keep).checks] });
	}
	const p = await main(["--root", plain]);
	assert.match(p.text, /SKIP against: every new check and test run was inconclusive on the code at HEAD/, "without keep the spec file is missing on the old code, which proves nothing");
	const k = await main(["--root", kept]);
	assert.equal(k.code, 0, k.text);
	assert.match(k.text, /PASS against HEAD: spec fail\(s\) on the code before the change/);
});

test("small messages: nothing ran, --skip outside git, and the evidence-status reasons", async () => {
	const dir = project({ checks: [{ name: "a", args: [node, "-v"] }] });
	await rejects(dir, ["--skip-checks"], /nothing ran: every step was skipped/);
	await rejects(dir, ["--skip", "the database is not reachable from here"], /--skip needs a git repository/);
	await main(["--root", dir]);
	assert.match((await main(["--root", dir, "--evidence-status"])).text, /evidence: NOT ok, not a git repository, so the evidence cannot be matched to the code/);

	const g = repo({ checks: [{ name: "a", args: [node, "-v"] }] });
	write(g, ".stack-agent/evidence/latest.json", JSON.stringify({ ok: true, full: true, at: "2026-10-01T00:00:00Z" }));
	assert.match((await main(["--root", g, "--evidence-status"])).text, /the evidence has no fingerprint \(written by an older verify\)/);
});

test("removing the against worktree refuses to go on when a linked folder's real copy is gone", async () => {
	const { createWorktree, removeWorktree } = await import("../scripts/verify.mjs");
	const dir = repo({ checks: [{ name: "a", args: [node, "-v"] }] });
	// installed, never committed, as in a real project
	write(dir, ".gitignore", ".stack-agent/evidence/\nnode_modules/\n");
	write(dir, "node_modules/dep/index.js", "module.exports = 1;\n");
	const made = createWorktree(dir, "HEAD", { link: ["node_modules"] });
	assert.equal(made.error, undefined, made.error);
	assert.equal(made.links.length, 1);
	const real = path.join(dir, "node_modules");
	fs.renameSync(real, real + ".moved");
	try {
		assert.throws(() => removeWorktree(made.top, made.tmp, made.links), /node_modules is missing after removing the link to it from the against worktree/);
	} finally {
		fs.renameSync(real + ".moved", real);
		removeWorktree(made.top, made.tmp, made.links);
	}
	assert.ok(fs.existsSync(path.join(real, "dep/index.js")), "the real folder is untouched");
});
