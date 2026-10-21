// Edge cases closed after the second review: pinned settings and record path (E0), a baseline before the first
// change when SessionStart did not run (E3), a skip declared in the final message (E1), and protection for a
// custom evidenceDir (E4).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ensureSessionRecord, readStart } from "../scripts/hooks/session-record.mjs";
import { markerReason } from "../scripts/hooks/stop-verify.mjs";
import { copySample, freePort, git, repoRoot, runNode, usePort, write } from "./helpers.mjs";

const hook = (name) => path.join(repoRoot, "scripts", "hooks", name);
const verify = path.join(repoRoot, "scripts", "verify.mjs");
const SID = "edge";
const run = (name, dir, extra = {}) => runNode(hook(name), [], { input: JSON.stringify({ cwd: dir, session_id: SID, ...extra }) });
const stop = (dir, extra) => run("stop-verify.mjs", dir, extra);
const sessionStart = (dir) => run("session-start.mjs", dir);
const touch = (dir, rel, text = "\n") => write(dir, rel, fs.readFileSync(path.join(dir, rel), "utf8") + text);
const SERVICE = "src/modules/items/service.js";
const decision = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : undefined);
const editConfig = (dir, fn) => {
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	fn(config);
	fs.writeFileSync(file, JSON.stringify(config, null, 2));
};

async function repo(configure) {
	const dir = copySample();
	usePort(dir, await freePort());
	if (configure) editConfig(dir, configure);
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	return dir;
}

// E0
test("moving evidenceDir and switching stopHook mid-session changes nothing for that session", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, SERVICE);
	editConfig(dir, (c) => {
		c.evidenceDir = "src";
		c.stopHook = "remind";
	});
	const r = stop(dir);
	assert.equal(r.code, 2, r.stderr);
	assert.match(r.stderr, /Stop 1 of 3/);
	assert.ok(fs.existsSync(path.join(dir, ".stack-agent/evidence/sessions", `${SID}.start.json`)), "the record stays at the fixed path");
	assert.equal(readStart(dir, SID).evidenceDir, ".stack-agent/evidence");
});

test("session records stay at the fixed path with a custom evidenceDir", async () => {
	const dir = await repo((c) => (c.evidenceDir = "out/evidence"));
	sessionStart(dir);
	assert.ok(fs.existsSync(path.join(dir, ".stack-agent/evidence/sessions", `${SID}.start.json`)));
	assert.equal(fs.existsSync(path.join(dir, "out/evidence/sessions")), false);
});

// E3
test("without SessionStart, the first edit records the baseline, so a later commit still blocks", async () => {
	const dir = await repo();
	const pre = run("pre-edit-protect.mjs", dir, { tool_name: "Edit", tool_input: { file_path: path.join(dir, SERVICE) } });
	assert.equal(pre.code, 0, pre.stderr);
	assert.equal(decision(pre), undefined, "recording the baseline never asks or denies");
	assert.ok(readStart(dir, SID), "baseline recorded before the edit");
	touch(dir, SERVICE);
	git(dir, "commit", "-qam", "work");
	const r = stop(dir);
	assert.equal(r.code, 2);
	assert.match(r.stderr, /changes committed since the session started/);
});

test("the first shell command also records the baseline", async () => {
	const dir = await repo();
	run("pre-bash.mjs", dir, { tool_name: "Bash", tool_input: { command: "ls" } });
	assert.ok(readStart(dir, SID));
});

test("the first baseline wins; later attempts never overwrite it", async () => {
	const dir = await repo();
	assert.equal(ensureSessionRecord(dir, SID), "created");
	const first = readStart(dir, SID).fingerprint;
	touch(dir, SERVICE);
	assert.equal(ensureSessionRecord(dir, SID), "exists");
	sessionStart(dir);
	assert.equal(readStart(dir, SID).fingerprint, first);
});

test("the Stop hook never writes a baseline from the current tree", async () => {
	const dir = await repo();
	touch(dir, SERVICE);
	assert.equal(stop(dir).code, 2, "no record: changed files still block, as before");
	assert.equal(readStart(dir, SID), null);
	assert.equal(stop(dir, { stop_hook_active: true }).code, 2, "and keep blocking");
});

// E1
test("markerReason only accepts the last non-empty line", () => {
	assert.equal(markerReason("Done.\n\nstack-agent-skip: node is not installed in this sandbox\n"), "node is not installed in this sandbox");
	assert.equal(markerReason("End with `stack-agent-skip: <reason>` if needed.\nAll verified."), null);
	assert.equal(markerReason(undefined), null);
});

test("a skip declared in the final message unblocks, is recorded by the hook, and is announced once", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, SERVICE);
	const message = "The rule is in place but unverified.\nstack-agent-skip: the sandbox cannot run node, so verify.mjs cannot start";
	const first = stop(dir, { last_assistant_message: message });
	assert.equal(first.code, 0, first.stderr);
	assert.match(JSON.parse(first.stdout).systemMessage, /recorded why in \.stack-agent\/verify-skip\.json: "the sandbox cannot run node/);
	const record = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/verify-skip.json"), "utf8"));
	assert.equal(record.via, "message");
	assert.match(record.fingerprint, /^[0-9a-f]{64}$/);
	assert.equal(stop(dir, { last_assistant_message: message }).stdout, "", "announced once");
	touch(dir, "src/modules/items/repository.js");
	assert.equal(stop(dir).code, 2, "a later change needs verification or a new skip");
});

test("a marker in the middle of the message, a short reason, or no message field keeps blocking", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, SERVICE);
	assert.equal(stop(dir, { last_assistant_message: "stack-agent-skip: the sandbox cannot run node here\nActually I verified it." }).code, 2);
	const short = stop(dir, { last_assistant_message: "stack-agent-skip: no node", stop_hook_active: true });
	assert.equal(short.code, 2);
	assert.match(short.stderr, /needs a reason of at least 15 characters/);
	assert.equal(stop(dir, { stop_hook_active: true }).code, 2);
});

test("the message skip still works when the skip file cannot be written", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, SERVICE);
	fs.mkdirSync(path.join(dir, ".stack-agent/verify-skip.json"));
	const r = stop(dir, { last_assistant_message: "stack-agent-skip: the repo is read-only in this sandbox" });
	assert.equal(r.code, 0, r.stderr);
	assert.match(JSON.parse(r.stdout).systemMessage, /said why in its final message: "the repo is read-only/);
});

test("a marker is ignored when the evidence already matches the code", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, SERVICE);
	assert.equal(runNode(verify, ["--root", dir, "--no-against"]).code, 0);
	editConfig(dir, () => {});
	const fresh = runNode(verify, ["--root", dir]);
	assert.equal(fresh.code, 0, fresh.stdout + fresh.stderr);
	const r = stop(dir, { last_assistant_message: "stack-agent-skip: not needed, but declared anyway here" });
	assert.equal(r.code, 0);
	assert.equal(fs.existsSync(path.join(dir, ".stack-agent/verify-skip.json")), false);
});

// E4
test("a custom evidenceDir's latest.json asks before Edit/Write or a shell write, and reading stays free", async () => {
	const dir = await repo((c) => (c.evidenceDir = "out/ev"));
	sessionStart(dir);
	assert.equal(decision(run("pre-edit-protect.mjs", dir, { tool_name: "Write", tool_input: { file_path: path.join(dir, "out/ev/latest.json") } })), "ask");
	assert.equal(decision(run("pre-bash.mjs", dir, { tool_name: "Bash", tool_input: { command: "cp fake.json out/ev/latest.json" } })), "ask");
	assert.equal(decision(run("pre-bash.mjs", dir, { tool_name: "Bash", tool_input: { command: "cat out/ev/latest.json" } })), undefined);
	editConfig(dir, (c) => (c.evidenceDir = "elsewhere"));
	assert.equal(decision(run("pre-edit-protect.mjs", dir, { tool_name: "Write", tool_input: { file_path: path.join(dir, "out/ev/latest.json") } })), "ask", "the snapshotted dir stays protected");
});

// review round on E0-E4
test("deleting the baseline and making another call does not reset it; the hook keeps blocking", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, SERVICE);
	fs.unlinkSync(path.join(dir, ".stack-agent/evidence/sessions", `${SID}.start.json`));
	run("pre-bash.mjs", dir, { tool_name: "Bash", tool_input: { command: "ls" } });
	assert.equal(readStart(dir, SID), null, "no new baseline from the changed tree");
	const r = stop(dir);
	assert.equal(r.code, 2, r.stderr);
	assert.match(r.stderr, /session record under \.stack-agent\/evidence\/sessions was removed/);
});

test("shell commands that name the session records ask, whatever the program", () => {
	for (const command of ["unlink .stack-agent/evidence/sessions/x.start.json", "find .stack-agent/evidence/sessions -name '*.json' -delete", "ri .stack-agent\\evidence\\sessions\\x.json", "python -c \"import os; os.remove('.stack-agent/evidence/sessions/x.json')\""]) {
		const r = runNode(hook("pre-bash.mjs"), [], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }) });
		assert.equal(decision(r), "ask", command);
	}
});

test("a session whose start file is old but whose state is fresh is kept by pruning and by the against step", async () => {
	const dir = await repo();
	sessionStart(dir);
	const sessions = path.join(dir, ".stack-agent/evidence/sessions");
	const start = path.join(sessions, `${SID}.start.json`);
	const old = new Date(Date.now() - 8 * 24 * 3600_000);
	fs.utimesSync(start, old, old);
	write(dir, `.stack-agent/evidence/sessions/${SID}.json`, "{}");
	runNode(hook("session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "other" }) });
	assert.ok(fs.existsSync(start), "an active session is not pruned");
	const stale = path.join(sessions, "gone.start.json");
	write(dir, ".stack-agent/evidence/sessions/gone.start.json", "{}");
	fs.utimesSync(stale, old, old);
	runNode(hook("session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "third" }) });
	assert.equal(fs.existsSync(stale), false, "an idle session is pruned");
});

test("the against step still uses a session that started more than a day ago but is active", async () => {
	const dir = await repo();
	sessionStart(dir);
	const startHead = git(dir, "rev-parse", "HEAD").trim();
	const start = path.join(dir, ".stack-agent/evidence/sessions", `${SID}.start.json`);
	const rec = JSON.parse(fs.readFileSync(start, "utf8"));
	fs.writeFileSync(start, JSON.stringify({ ...rec, at: new Date(Date.now() - 36 * 3600_000).toISOString() }));
	const dayAgo = new Date(Date.now() - 36 * 3600_000);
	fs.utimesSync(start, dayAgo, dayAgo);
	write(dir, `.stack-agent/evidence/sessions/${SID}.json`, "{}");
	write(dir, SERVICE, fs.readFileSync(path.join(dir, SERVICE), "utf8").replace('if (!name) return { error: "name is required" };', 'if (!name) return { error: "name is required" };\n\tif (name.length > 50) return { error: "name is too long" };'));
	editConfig(dir, (c) => c.checks.push({ name: "accepts-50", method: "POST", path: "/items", body: { name: "x".repeat(50) }, expectStatus: 201 }));
	git(dir, "commit", "-qam", "work");
	const r = runNode(verify, ["--root", dir, "--json"]);
	const against = JSON.parse(r.code === 0 ? r.stdout : r.stderr).steps.find((s) => s.step === "against");
	assert.equal(against.ref, startHead);
});

test("a custom evidenceDir is protected from inline scripts and Git Bash paths too", async () => {
	const dir = await repo((c) => (c.evidenceDir = "build/ev"));
	sessionStart(dir);
	const ask = (command) => decision(run("pre-bash.mjs", dir, { tool_name: "Bash", tool_input: { command } }));
	assert.equal(ask(`node -e "require('fs').writeFileSync('build/ev/latest.json','{}')"`), "ask");
	if (process.platform === "win32") {
		const msys = "/" + dir[0].toLowerCase() + dir.slice(2).replaceAll("\\", "/") + "/build/ev/latest.json";
		assert.equal(ask(`cp x ${msys}`), "ask");
	}
});

test("NotebookEdit also records the baseline before the first change", async () => {
	const dir = await repo();
	run("pre-edit-protect.mjs", dir, { tool_name: "NotebookEdit", tool_input: { notebook_path: path.join(dir, "notes.ipynb") } });
	assert.ok(readStart(dir, SID));
});

test("after the record was removed, a full passing verify still lets the agent stop", async () => {
	const dir = await repo();
	sessionStart(dir);
	touch(dir, SERVICE);
	fs.unlinkSync(path.join(dir, ".stack-agent/evidence/sessions", `${SID}.start.json`));
	assert.equal(stop(dir).code, 2);
	assert.equal(runNode(verify, ["--root", dir]).code, 0);
	assert.equal(stop(dir).code, 0);
});

// second review round on the session records
test("deleting the records with globs or the ledger folder asks, and reading them does not", () => {
	const ask = (command) => decision(runNode(hook("pre-bash.mjs"), [], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }) }));
	for (const command of ["rm .stack-agent/evid*/sess*/*", 'rm -r "$TMPDIR/stack-agent-sessions"', "Remove-Item -Recurse $env:TEMP\\stack-agent-sessions"]) assert.equal(ask(command), "ask", command);
	for (const command of ["ls .stack-agent/evidence/sessions", "cat .stack-agent/evidence/sessions/x.start.json"]) assert.equal(ask(command), undefined, command);
});

test("pruning an idle session also removes its ledger notes, so it can start clean later", async () => {
	const { ledgerFile } = await import("../scripts/hooks/session-record.mjs");
	const dir = await repo();
	sessionStart(dir);
	const note = ledgerFile(dir, SID, "taken");
	assert.ok(fs.existsSync(note), "a note is kept when the baseline is taken");
	const old = new Date(Date.now() - 8 * 24 * 3600_000);
	fs.utimesSync(path.join(dir, ".stack-agent/evidence/sessions", `${SID}.start.json`), old, old);
	runNode(hook("session-start.mjs"), [], { input: JSON.stringify({ cwd: dir, session_id: "other" }) });
	assert.equal(fs.existsSync(note), false);
	sessionStart(dir);
	assert.ok(readStart(dir, SID), "the resumed session takes a fresh baseline instead of looking tampered with");
});
