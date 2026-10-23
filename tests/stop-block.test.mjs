import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MAX_BLOCKS } from "../scripts/hooks/stop-verify.mjs";
import { copySample, freePort, git, repoRoot, runNode, usePort, write } from "./helpers.mjs";

const hook = (name) => path.join(repoRoot, "scripts", "hooks", name);
const verify = path.join(repoRoot, "scripts", "verify.mjs");
const stop = (dir, extra = {}) => runNode(hook("stop-verify.mjs"), [], { input: JSON.stringify({ hook_event_name: "Stop", cwd: dir, session_id: "s1", ...extra }) });
const sessionStart = (dir, extra = {}) => runNode(hook("session-start.mjs"), [], { input: JSON.stringify({ hook_event_name: "SessionStart", cwd: dir, session_id: "s1", ...extra }) });
const touch = (dir, rel, text = "\n") => write(dir, rel, fs.readFileSync(path.join(dir, rel), "utf8") + text);

async function repo() {
	const dir = copySample();
	usePort(dir, await freePort());
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	return dir;
}

test("block mode keeps blocking while the agent continues, then releases with a message to the human", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, "src/modules/items/service.js");
	for (let n = 1; n <= MAX_BLOCKS; n++) {
		const r = stop(dir, { stop_hook_active: n > 1 });
		assert.equal(r.code, 2, `block ${n}: ${r.stderr}`);
		assert.match(r.stderr, new RegExp(`Stop ${n} of ${MAX_BLOCKS}`));
		assert.match(r.stderr, /verify\.mjs --skip/);
	}
	const released = stop(dir, { stop_hook_active: true });
	assert.equal(released.code, 0);
	assert.match(JSON.parse(released.stdout).systemMessage, /stopping with unverified changes/);
	assert.equal(stop(dir, { stop_hook_active: false }).code, 2, "the next user turn blocks again");
});

test("the cap holds even when the agent edits code before every stop", async () => {
	const dir = await repo();
	sessionStart(dir);
	const codes = [];
	for (let n = 0; n < MAX_BLOCKS + 2; n++) {
		touch(dir, "src/modules/items/service.js", `// ${n}\n`);
		codes.push(stop(dir, { stop_hook_active: n > 0 }).code);
	}
	assert.deepEqual(codes.slice(0, MAX_BLOCKS + 1), [...Array(MAX_BLOCKS).fill(2), 0]);
});

test("a tree the human left dirty does not block a session that changed nothing", async () => {
	const dir = await repo();
	touch(dir, "src/modules/items/service.js");
	sessionStart(dir);
	assert.equal(stop(dir).code, 0);
	touch(dir, "src/modules/items/repository.js");
	assert.equal(stop(dir).code, 2, "a change made in the session blocks");
});

test("a full passing verify run unblocks, and stays valid after a commit but not after a back-dated edit", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, "src/modules/items/service.js");
	// a test changes with the code, so the Stop hook has no reason to ask for one (see tests/no-coverage.test.mjs)
	touch(dir, "test/items.test.js");
	assert.equal(stop(dir).code, 2);
	const run = runNode(verify, ["--root", dir]);
	assert.equal(run.code, 0, run.stdout + run.stderr);
	assert.match(JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8")).fingerprint, /^[0-9a-f]{64}$/);
	assert.equal(stop(dir).code, 0);
	git(dir, "add", "-A", "--", "src");
	git(dir, "commit", "-qm", "change");
	assert.equal(stop(dir).code, 0, "committing does not make the evidence stale");

	const file = path.join(dir, "src/modules/items/repository.js");
	touch(dir, "src/modules/items/repository.js", "// later\n");
	const past = new Date(Date.now() - 3600_000);
	fs.utimesSync(file, past, past);
	assert.equal(stop(dir).code, 2, "the fingerprint catches an edit an mtime comparison would miss");
});

test("verify --skip records a reason that unblocks only the current code, announced once", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, "src/modules/items/service.js");
	const short = runNode(verify, ["--root", dir, "--skip", "no time"]);
	assert.equal(short.code, 2);
	assert.match(short.stderr, /at least 15 characters/);
	const ok = runNode(verify, ["--root", dir, "--skip", "the database server is not reachable from this machine"]);
	assert.equal(ok.code, 0, ok.stderr);
	assert.match(JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/verify-skip.json"), "utf8")).reason, /database server/);
	const first = stop(dir);
	assert.equal(first.code, 0);
	assert.match(JSON.parse(first.stdout).systemMessage, /recorded why in \.stack-agent\/verify-skip\.json: "the database server/);
	const second = stop(dir);
	assert.equal(second.code, 0);
	assert.equal(second.stdout, "", "announced once");
	touch(dir, "src/modules/items/repository.js");
	assert.equal(stop(dir).code, 2, "a later change needs verification or a new skip");
});

test("a skip still works when stopHookIgnore does not exclude .stack-agent", async () => {
	const dir = await repo();
	const file = path.join(dir, ".stack-agent/verify.json");
	fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), stopHookIgnore: ["**/*.md"] }, null, 2));
	git(dir, "commit", "-qam", "config");
	sessionStart(dir);
	touch(dir, "src/modules/items/service.js");
	assert.equal(runNode(verify, ["--root", dir, "--skip", "the database server is not reachable here"]).code, 0);
	assert.equal(stop(dir).code, 0);
});

test("evidence written before fingerprints existed still uses the mtime rule", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, "src/modules/items/service.js");
	const later = new Date(Date.now() + 5000);
	write(dir, ".stack-agent/evidence/latest.json", JSON.stringify({ ok: true, full: true }));
	fs.utimesSync(path.join(dir, ".stack-agent/evidence/latest.json"), later, later);
	assert.equal(stop(dir).code, 0);
});

test("evidence and the skip record cannot be written by hand without a human, but can be read", () => {
	const ask = (input) => {
		const r = runNode(hook(input.tool_name === "Bash" ? "pre-bash.mjs" : "pre-edit-protect.mjs"), [], { input: JSON.stringify(input) });
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : undefined;
	};
	assert.equal(ask({ tool_name: "Write", tool_input: { file_path: "/p/.stack-agent/evidence/latest.json" } }), "ask");
	assert.equal(ask({ tool_name: "Edit", tool_input: { file_path: "C:\\p\\.stack-agent\\verify-skip.json" } }), "ask");
	assert.equal(ask({ tool_name: "Bash", tool_input: { command: "cat .stack-agent/evidence/latest.json" } }), undefined);
	assert.equal(ask({ tool_name: "Bash", tool_input: { command: 'node .stack-agent/bin/verify.mjs --skip "the database is down here"' } }), undefined);
});
