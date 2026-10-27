// How verify waits for the commands it runs: a process a command leaves behind, a command killed by a signal, and a
// verify that is itself interrupted.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { main } from "../scripts/verify.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { processGone, tempDir, write } from "./helpers.mjs";

const node = process.execPath;
const verifyScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "verify.mjs");

function project(config, files = {}) {
	const dir = tempDir("stack-agent-proc-");
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	write(dir, ".stack-agent/verify.json", JSON.stringify(config));
	return dir;
}

const killPid = (file) => {
	try {
		process.kill(Number(fs.readFileSync(file, "utf8")));
	} catch {}
};

// starts a background process that inherits the output pipes, prints, and exits at once
const leaver = `const { spawn } = require("child_process");
const c = spawn(process.execPath, ["-e", "require('fs').writeFileSync('left.pid', String(process.pid)); setTimeout(() => {}, 20000)"], { stdio: "inherit" });
c.unref();
setTimeout(() => { console.log("started"); process.exit(0); }, 300);
`;

// on Windows a child started with "inherit" does not keep the parent's pipe; cmd's start /b does
const sleeper = "require('fs').writeFileSync('left.pid', String(process.pid)); setTimeout(() => {}, 20000);\n";
const leaving =
	process.platform === "win32"
		? { name: "leaves", command: `start /b "" "${node}" sleeper.cjs && echo started`, timeoutSec: 8, expectOutputIncludes: "started" }
		: { name: "leaves", args: [node, "leaver.cjs"], timeoutSec: 8, expectOutputIncludes: "started" };

test("a command that leaves a process holding its output passes on its exit code instead of hanging or timing out", async () => {
	const dir = project({ checks: [leaving] }, { "leaver.cjs": leaver, "sleeper.cjs": sleeper });
	const started = Date.now();
	try {
		const r = await main(["--root", dir]);
		const seconds = (Date.now() - started) / 1000;
		assert.equal(r.code, 0, r.text);
		assert.ok(seconds < 6, `took ${seconds}s; it waited for the background process`);
		const step = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8")).steps[0];
		assert.equal(step.timedOut, false);
		assert.match(step.output, /verify: the command exited but a process it started kept running/);
		assert.match(step.output, /and stopped it]/);
		assert.ok(await processGone(path.join(dir, "left.pid")), "the leftover is stopped, on Windows too");
	} finally {
		killPid(path.join(dir, "left.pid"));
	}
});

test("a command killed by a signal is reported as such, not as an exit code or a timeout", { skip: process.platform === "win32" ? "Windows has no signals to kill with" : false }, async () => {
	const dir = project({ test: { args: [node, "-e", "process.kill(process.pid, 'SIGSEGV')"] }, checks: [{ name: "crash", args: [node, "-e", "process.kill(process.pid, 'SIGABRT')"] }] });
	const r = await main(["--root", dir, "--no-against"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /FAIL tests: .* \(killed by SIGSEGV\)/);
	assert.match(r.text, /killed by SIGABRT, expected exit 0/);
	const rep = await main(["--root", dir, "--skip-checks", "--repeat", "2"]);
	assert.match(rep.text, /red in 2 of 2 runs \(100%\)\n {2}2x killed by SIGSEGV/);
	assert.doesNotMatch(rep.text, /inconclusive/, "a crash is a real red");
});

test("--skip-tests cannot be combined with --skip-checks --repeat", async () => {
	const dir = project({ test: { args: [node, "-v"] }, checks: [{ name: "a", args: [node, "-v"] }] });
	await assert.rejects(main(["--root", dir, "--skip-tests", "--skip-checks", "--repeat", "2"]), (e) => e instanceof ConfigError && /cannot be used with --skip-tests/.test(e.message));
});

test("an interrupted verify stops the commands it started", { skip: process.platform === "win32" ? "Windows cannot send a catchable SIGTERM" : false }, async () => {
	const dir = project({ checks: [{ name: "slow", args: [node, "-e", "require('fs').writeFileSync('slow.pid', String(process.pid)); setTimeout(() => {}, 30000)"], timeoutSec: 60 }] });
	const child = spawn(node, [verifyScript, "--root", dir], { stdio: ["ignore", "pipe", "pipe"] });
	let err = "";
	child.stderr.on("data", (d) => (err += d));
	const pidFile = path.join(dir, "slow.pid");
	for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100));
	assert.ok(fs.existsSync(pidFile), "the slow check started");
	child.kill("SIGTERM");
	const code = await new Promise((r) => child.on("close", r));
	assert.equal(code, 143);
	assert.match(err, /interrupted by SIGTERM/);
	assert.ok(await processGone(pidFile), "the check's process is gone");
});
