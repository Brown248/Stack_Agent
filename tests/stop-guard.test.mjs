// The after-edit hook runs the guard on Edit and Write only, so a violation added through the shell (sed -i, a
// script) reached CI before anything said so. The Stop hook now runs the guard on the files the session changed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { decideBlock, guardMessage, MAX_BLOCKS } from "../scripts/hooks/stop-verify.mjs";
import { copySample, git, repoRoot, runNode, write } from "./helpers.mjs";

const SID = "guard";
const stop = (dir, extra = {}) => runNode(path.join(repoRoot, "scripts/hooks/stop-verify.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: SID, ...extra }) });
const sessionStart = (dir) => runNode(path.join(repoRoot, "scripts/hooks/session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: SID }) });
const CONTROLLER = "src/modules/items/controller.js";
const addSql = (dir) => fs.appendFileSync(path.join(dir, CONTROLLER), '\nexport const q = "SELECT * FROM items WHERE id = 1";\n');

function repo() {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	return dir;
}

test("a violation added outside Edit/Write blocks the stop with the rule and its fix", () => {
	const dir = repo();
	sessionStart(dir);
	addSql(dir);
	const r = stop(dir);
	assert.equal(r.code, 2);
	assert.match(r.stderr, /the guard fails on files changed in this session/);
	assert.match(r.stderr, /src\/modules\/items\/controller\.js:\d+ \[no-sql-in-controller\] .*; fix: /);
	assert.match(r.stderr, new RegExp(`Stop 1 of ${MAX_BLOCKS}`));
});

test("a recorded skip does not cover a guard violation", () => {
	const dir = repo();
	sessionStart(dir);
	addSql(dir);
	assert.equal(runNode(path.join(repoRoot, "scripts/verify.mjs"), ["--root", dir, "--skip", "no database in this sandbox, cannot run"]).code, 0);
	assert.match(stop(dir).stderr, /the guard fails/);
});

test("a violation committed during the session is still found", () => {
	const dir = repo();
	sessionStart(dir);
	addSql(dir);
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "query");
	assert.match(stop(dir).stderr, /\[no-sql-in-controller\]/);
});

test("a file the human left dirty before the session is not blamed on the agent", () => {
	const dir = repo();
	addSql(dir);
	sessionStart(dir);
	fs.appendFileSync(path.join(dir, "src/modules/items/service.js"), "\n");
	const r = stop(dir);
	assert.doesNotMatch(r.stderr, /the guard fails/);
	assert.equal(r.code, 2, "the usual verification reminder still applies to the agent's own change");
});

test("fixing the violation moves on to the usual verification check", () => {
	const dir = repo();
	sessionStart(dir);
	addSql(dir);
	assert.equal(stop(dir).code, 2);
	write(dir, CONTROLLER, fs.readFileSync(path.join(dir, CONTROLLER), "utf8").replace('\nexport const q = "SELECT * FROM items WHERE id = 1";\n', "\n// reviewed\n"));
	const r = stop(dir, { stop_hook_active: true });
	assert.doesNotMatch(r.stderr, /the guard fails/);
	assert.match(r.stderr, /there is no verify evidence yet/);
});

test("after the block cap, the stop is released with the violations named for the human", () => {
	const root = repoRoot;
	const current = { value: "now", entries: new Map() };
	const base = { root, files: ["README.md"], ignore: [], current, skip: null, sessionStart: { fingerprint: "before", dirty: {} }, guardFailures: ["a.js:1 [r] m; fix: f"] };
	let state = {};
	for (let i = 1; i <= MAX_BLOCKS; i++) {
		const v = decideBlock({ ...base, state, stopHookActive: i > 1 });
		assert.equal(v.kind, "guard");
		state = v.state;
	}
	const last = decideBlock({ ...base, state, stopHookActive: true });
	assert.equal(last.action, "release");
	assert.match(last.message, /stopping with guard violations after 3 reminders: a\.js:1 \[r\] m/);
	assert.match(guardMessage(["x"], 2), /Stop 2 of 3/);
});
