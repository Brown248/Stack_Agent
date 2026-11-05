// verify --doctor: is this machine ready? It reads and looks. It never runs the test command, a check, or the server.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { test } from "node:test";
import { findProgram, main } from "../scripts/verify.mjs";
import { tempDir, write } from "./helpers.mjs";

const doctor = (dir, ...args) => main(["--root", dir, "--doctor", ...args]);

function project(config, files = {}) {
	const dir = tempDir("stack-agent-doctor-");
	write(dir, ".stack-agent/verify.json", JSON.stringify({ against: false, ...config }));
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	return dir;
}
const NODE = { args: [process.execPath, "-v"] };
const freePort = () =>
	new Promise((resolve) => {
		const s = net.createServer();
		s.listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => resolve(port));
		});
	});

test("a project whose programs exist, with no server, is ready, and --json says the same as data", async () => {
	const dir = project({ test: { command: "node -v" }, checks: [{ name: "c", command: "node -v" }, { name: "d", ...NODE }] });
	const r = await doctor(dir);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /doctor: ready/);
	const data = JSON.parse((await doctor(dir, "--json")).text);
	assert.deepEqual([data.ready, data.problems], [true, []]);
});

test("a program that is not there is named with the step it belongs to, in the command form and the args form", async () => {
	const dir = project({ test: { command: "definitely-not-a-program-xyz --run" }, checks: [{ name: "c", args: ["also-not-a-program-xyz", "x"] }] });
	const r = await doctor(dir);
	assert.equal(r.code, 2);
	assert.match(r.text, /problem: test: definitely-not-a-program-xyz was not found on PATH/);
	assert.match(r.text, /problem: check c: also-not-a-program-xyz was not found on PATH/);
	assert.match(r.text, /doctor: NOT ready \(2 problem\(s\)\)/);
});

test("a script path is looked up against the folder the step runs in, and a missing cwd is reported", async () => {
	const dir = project({ test: { command: "./scripts/run-tests.sh", cwd: "sub" }, checks: [{ name: "c", command: "node x.js", cwd: "nowhere" }] }, { "sub/keep": "x" });
	const r = await doctor(dir);
	assert.match(r.text, /test: \.\/scripts\/run-tests\.sh was not found \(looked for .*sub\/scripts\/run-tests\.sh\)/);
	assert.match(r.text, /check c: the folder nowhere does not exist/);
});

test("shell builtins and commands it cannot read are not guessed at", async () => {
	const dir = project({ test: { command: "cd sub && definitely-not-here --x" }, checks: [{ name: "a", command: "$RUNNER test" }, { name: "b", command: "(echo hi)" }] });
	const r = await doctor(dir);
	assert.equal(r.code, 0, r.text);
});

test("a leading VAR=value is skipped on systems whose shell reads it", { skip: process.platform === "win32" }, async () => {
	assert.equal((await doctor(project({ test: { command: "FOO=1 node -v" } }))).code, 0);
	assert.equal((await doctor(project({ test: { command: "FOO=1 not-a-program-xyz" } }))).code, 2);
});

test("it neither runs the test command nor starts the server", async () => {
	const marker = (name) => ({ args: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(name)}, 'ran')`] });
	const dir = project({ test: marker("test-ran.txt"), server: { ...marker("server-ran.txt"), readyUrl: `http://127.0.0.1:${await freePort()}/` }, checks: [{ name: "c", ...marker("check-ran.txt") }] });
	const r = await doctor(dir);
	assert.equal(r.code, 0, r.text);
	for (const f of ["test-ran.txt", "server-ran.txt", "check-ran.txt"]) assert.ok(!fs.existsSync(path.join(dir, f)), `${f} was written, so something ran`);
});

test("a port that is taken, by something that does not even speak HTTP, is a problem; a free one is not", async () => {
	const sockets = new Set();
	const taken = net.createServer((sock) => {
		sockets.add(sock);
		sock.on("error", () => {});
	});
	await new Promise((r) => taken.listen(0, "127.0.0.1", r));
	const port = taken.address().port;
	try {
		const dir = project({ server: { ...NODE, readyUrl: `http://127.0.0.1:${port}/health` }, checks: [{ name: "c", ...NODE }] });
		const r = await doctor(dir);
		assert.equal(r.code, 2);
		assert.match(r.text, new RegExp(`port ${port} \\(server\\.readyUrl\\) is already in use`));
	} finally {
		for (const sock of sockets) sock.destroy();
		await new Promise((r) => taken.close(r));
	}
	const ok = project({ test: NODE, server: { ...NODE, readyUrl: `http://127.0.0.1:${await freePort()}/` } });
	assert.equal((await doctor(ok)).code, 0);
	assert.match((await doctor(project({ test: NODE, server: { ...NODE, readyUrl: "not a url" } }))).text, /server\.readyUrl is not a valid URL/);
	assert.equal((await doctor(project({ test: NODE, server: { ...NODE, readyUrl: "http://example.invalid:8080/" } }))).code, 0, "a host other than this machine is not tested");
});

test("the against step: no git or no commit is a note, not a problem", async () => {
	const dir = project({ against: true, test: NODE });
	const r = await doctor(dir);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /note: not a git repository/);
	spawnSync("git", ["init", "-q"], { cwd: dir });
	assert.match((await doctor(dir)).text, /note: no commit to compare with yet/);
});

test("an evidence folder that does not exist yet, under a writable parent, is not a problem", async () => {
	const dir = project({ test: NODE, evidenceDir: "deep/er/evidence" });
	assert.equal((await doctor(dir)).code, 0);
});

test("findProgram finds a bare name on PATH, a relative path in the given folder, and nothing else", () => {
	const dir = tempDir("stack-agent-find-");
	write(dir, "tools/run.cmd", "@echo off\n");
	write(dir, "tools/run.sh", "#!/bin/sh\n");
	if (process.platform !== "win32") fs.chmodSync(path.join(dir, "tools/run.sh"), 0o755);
	assert.ok(findProgram("node", dir));
	assert.equal(findProgram("no-such-program-xyz", dir), null);
	assert.ok(findProgram(process.platform === "win32" ? "./tools/run" : "./tools/run.sh", dir), "found relative to the folder");
	assert.equal(findProgram("./tools/missing", dir), null);
	assert.equal(findProgram("node", dir, { PATH: "" }), null, "an empty PATH finds nothing");
	if (process.platform === "win32") assert.ok(findProgram("run", path.join(dir, "tools"), { PATH: path.join(dir, "tools"), PATHEXT: ".CMD" }), "PATHEXT is tried");
	else assert.equal(findProgram("./tools/run.sh", dir, {}) !== null, true);
});

test("a broken config still stops with its own message before the doctor looks at anything", async () => {
	const dir = tempDir("stack-agent-doctor-");
	write(dir, ".stack-agent/verify.json", JSON.stringify({ checks: [{ name: "x", method: "GET" }] }));
	await assert.rejects(doctor(dir), /http checks need method, path, expectStatus/);
});

test("on Windows a .cmd script in args is a problem (args runs only .exe programs), while the same script in command is fine", { skip: process.platform !== "win32" }, async () => {
	const dir = tempDir("stack-agent-doctor-");
	write(dir, "tools/run.cmd", "@echo off\r\n");
	const saved = process.env.PATH;
	process.env.PATH = `${path.join(dir, "tools")}${path.delimiter}${process.env.PATH}`;
	try {
		write(dir, ".stack-agent/verify.json", JSON.stringify({ against: false, test: { args: ["run"] } }));
		const r = await doctor(dir);
		assert.equal(r.code, 2);
		assert.match(r.text, /test: run is a script, and "args" runs only .exe programs on Windows; use "command" for it/);
		write(dir, ".stack-agent/verify.json", JSON.stringify({ against: false, test: { command: "run" } }));
		assert.equal((await doctor(dir)).code, 0);
	} finally {
		process.env.PATH = saved;
	}
});
