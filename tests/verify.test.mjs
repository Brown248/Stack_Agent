import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { isSubset, joinUrl, main } from "../scripts/verify.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { copySample, freePort, usePort, write } from "./helpers.mjs";

async function sampleOnFreePort() {
	const dir = copySample();
	const port = await freePort();
	usePort(dir, port);
	return { dir, port };
}

async function portAnswers(port) {
	try {
		await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
		return true;
	} catch {
		return false;
	}
}

test("isSubset matches nested objects and exact arrays", () => {
	assert.ok(isSubset({ a: { b: 1 } }, { a: { b: 1, c: 2 }, d: 3 }));
	assert.ok(!isSubset({ a: { b: 2 } }, { a: { b: 1 } }));
	assert.ok(isSubset([1, { x: 1 }], [1, { x: 1, y: 2 }]));
	assert.ok(!isSubset([1], [1, 2]));
	assert.ok(!isSubset({ a: 1 }, null));
});

test("full run passes on the sample, writes evidence, and stops the server", async () => {
	const { dir, port } = await sampleOnFreePort();
	const r = await main(["--root", dir]);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /PASS tests/);
	assert.match(r.text, /PASS check create-item: POST \/items -> 201/);
	const latest = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8"));
	assert.equal(latest.ok, true);
	assert.equal(latest.steps.filter((s) => s.step === "check").length, 5);
	assert.equal(await portAnswers(port), false, "server must be stopped after the run");
});

test("a wrong expectation fails the run and the evidence says so", async () => {
	const { dir } = await sampleOnFreePort();
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.checks.find((c) => c.name === "create-item").expectStatus = 200;
	fs.writeFileSync(file, JSON.stringify(config));
	const r = await main(["--root", dir, "--skip-tests"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /FAIL check create-item: POST \/items -> 201 \(status 201, expected 200\)/);
	assert.equal(JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8")).ok, false);
});

test("expectJson mismatch is reported", async () => {
	const { dir } = await sampleOnFreePort();
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.checks.find((c) => c.name === "health").expectJson = { status: "down" };
	fs.writeFileSync(file, JSON.stringify(config));
	const r = await main(["--root", dir, "--skip-tests", "--check", "health"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /JSON does not contain/);
});

test("a failing test suite fails the run", async () => {
	const { dir } = await sampleOnFreePort();
	write(dir, "test/broken.test.js", 'import { test } from "node:test";\nimport assert from "node:assert";\ntest("broken", () => assert.equal(1, 2));\n');
	const r = await main(["--root", dir, "--skip-checks"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /FAIL tests: node --test \(exit 1\)/);
});

test("refuses to drive a server it did not start, unless --reuse", async () => {
	const { dir, port } = await sampleOnFreePort();
	const squatter = http.createServer((_q, s) => s.end('{"status":"ok"}')).listen(port, "127.0.0.1");
	await new Promise((r) => squatter.once("listening", r));
	try {
		const refused = await main(["--root", dir, "--skip-tests"]);
		assert.equal(refused.code, 1);
		assert.match(refused.text, /something already answers/);
		const reused = await main(["--root", dir, "--skip-tests", "--reuse", "--check", "health"]);
		assert.equal(reused.code, 0, reused.text);
		assert.equal(await portAnswers(port), true, "--reuse must not kill a server it did not start");
	} finally {
		squatter.close();
	}
});

test("a server that never becomes ready fails and is cleaned up", async () => {
	const { dir, port } = await sampleOnFreePort();
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.server.readyUrl = `http://127.0.0.1:${port}/does-not-exist-yet`;
	write(dir, "hang.cjs", 'require("fs").writeFileSync("hang.pid", String(process.pid));\nsetInterval(() => {}, 1000);\n');
	config.server.command = "node hang.cjs";
	config.server.readyTimeoutSec = 2;
	fs.writeFileSync(file, JSON.stringify(config));
	const r = await main(["--root", dir, "--skip-tests"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /not ready at/);
	const pid = Number(fs.readFileSync(path.join(dir, "hang.pid"), "utf8"));
	await new Promise((res) => setTimeout(res, 300));
	assert.throws(() => process.kill(pid, 0), /ESRCH/, "the server process must be killed");
});

test("a server that crashes on start is reported with its log", async () => {
	const { dir } = await sampleOnFreePort();
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.server.command = 'node -e "console.error(\'boom\'); process.exit(3)"';
	fs.writeFileSync(file, JSON.stringify(config));
	const r = await main(["--root", dir, "--skip-tests"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /exited with code 3/);
	assert.match(r.text, /boom/);
});

test("unknown --check names and empty configs are config errors", async () => {
	const { dir } = await sampleOnFreePort();
	await assert.rejects(main(["--root", dir, "--check", "nope"]), (e) => e instanceof ConfigError && /unknown check/.test(e.message));
	write(dir, ".stack-agent/verify.json", "{}");
	await assert.rejects(main(["--root", dir]), /needs test.command or checks/);
});

test("joinUrl keeps a base path prefix", () => {
	assert.equal(joinUrl("http://h/api/v1", "/items"), "http://h/api/v1/items");
	assert.equal(joinUrl("http://h/api/v1/", "items?x=1"), "http://h/api/v1/items?x=1");
	assert.equal(joinUrl("http://h", "http://other/x"), "http://other/x");
});

test("evidence records whether the run was full", async () => {
	const { dir } = await sampleOnFreePort();
	const partial = await main(["--root", dir, "--skip-tests", "--check", "health"]);
	assert.match(partial.text, /partial run: --skip-tests --check/);
	const read = () => JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8"));
	assert.equal(read().full, false);
	await main(["--root", dir]);
	assert.equal(read().full, true);
});

test("a test suite with more than 1 MB of output still passes", async () => {
	const { dir } = await sampleOnFreePort();
	write(dir, "noisy.cjs", 'for (let i = 0; i < 40000; i++) console.log("x".repeat(60));\n');
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.test.command = "node noisy.cjs";
	fs.writeFileSync(file, JSON.stringify(config));
	const r = await main(["--root", dir, "--skip-checks"]);
	assert.equal(r.code, 0, r.text);
});

test("a test command that times out is killed with its whole process tree", async () => {
	const { dir } = await sampleOnFreePort();
	write(dir, "slow.cjs", 'require("fs").writeFileSync("slow.pid", String(process.pid));\nsetInterval(() => {}, 1000);\n');
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.test = { command: "node slow.cjs", timeoutSec: 2 };
	fs.writeFileSync(file, JSON.stringify(config));
	const started = Date.now();
	const r = await main(["--root", dir, "--skip-checks"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /timed out/);
	assert.ok(Date.now() - started < 15000, "verify must return soon after the timeout");
	const pid = Number(fs.readFileSync(path.join(dir, "slow.pid"), "utf8"));
	await new Promise((res) => setTimeout(res, 300));
	assert.throws(() => process.kill(pid, 0), /ESRCH/, "the test process must be killed");
});
