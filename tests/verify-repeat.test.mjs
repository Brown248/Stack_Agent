import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main } from "../scripts/verify.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { freePort, tempDir, write } from "./helpers.mjs";

function project(config, files = {}) {
	const dir = tempDir("stack-agent-repeat-");
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	write(dir, ".stack-agent/verify.json", JSON.stringify(config));
	return dir;
}

const node = process.execPath;
const latest = (dir) => JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8"));
// fails on every second run: the count lives in a file, so each run is a fresh process that still sees the last one
const everySecond = 'const fs = require("fs"); const n = (fs.existsSync("count") ? Number(fs.readFileSync("count", "utf8")) : 0) + 1; fs.writeFileSync("count", String(n)); if (n % 2 === 0) { console.log("stale list on run " + n); process.exit(1); } console.log("fresh");\n';

test("--repeat runs a check N times and reports how many went red", async () => {
	const dir = project(
		{ test: { args: [node, "-e", 'require("fs").writeFileSync("tests-ran", "")'] }, checks: [{ name: "list", args: [node, "flaky.cjs"] }, { name: "other", args: [node, "-e", ""] }] },
		{ "flaky.cjs": everySecond },
	);
	const r = await main(["--root", dir, "--check", "list", "--repeat", "6"]);
	assert.equal(r.code, 1, r.text);
	assert.match(r.text, /RED check list x6: .*flaky\.cjs -> red in 3 of 6 runs \(50%\)/);
	assert.match(r.text, /3x exit 1, expected 0/);
	assert.match(r.text, /first red \(run 2\):\nstale list on run 2/);
	assert.match(r.text, /partial run/);
	assert.ok(!fs.existsSync(path.join(dir, "tests-ran")), "the test suite is not part of a repeat run");
	const rec = latest(dir);
	assert.equal(rec.ok, false);
	assert.equal(rec.full, false);
	assert.equal(rec.steps.length, 1, "only the named check runs");
	const [step] = rec.steps;
	assert.deepEqual(
		{ step: step.step, name: step.name, runs: step.runs, red: step.red, inconclusive: step.inconclusive, problems: step.problems, run: step.firstRed.run },
		{ step: "repeat", name: "list", runs: 6, red: 3, inconclusive: 0, problems: [{ text: "exit 1, expected 0", count: 3 }], run: 2 },
	);
	assert.equal(fs.readFileSync(path.join(dir, "count"), "utf8"), "6");
});

test("--repeat that never goes red passes, and never counts as a full run", async () => {
	const dir = project({ checks: [{ name: "ok", args: [node, "-e", "console.log('fine')"], expectOutputIncludes: "fine" }] });
	const r = await main(["--root", dir, "--check", "ok", "--repeat", "3"]);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /PASS check ok x3: .* -> red in 0 of 3 runs \(0%\)/);
	const rec = latest(dir);
	assert.equal(rec.ok, true);
	assert.equal(rec.full, false, "the Stop hook must not take a repeat run as evidence");
	assert.equal(rec.steps[0].firstRed, undefined);
});

test("--repeat keeps one server up across the runs of an HTTP check", async () => {
	const port = await freePort();
	const server = `const fs = require("fs"); fs.appendFileSync("starts", "x"); let n = 0;
require("http").createServer((req, res) => { if (req.url === "/") return res.end("up"); n++; res.statusCode = n % 3 === 0 ? 500 : 200; res.end(n % 3 === 0 ? "boom " + n : "[]"); }).listen(process.env.PORT, "127.0.0.1");\n`;
	const dir = project(
		{
			server: { args: [node, "server.cjs"], env: { PORT: String(port) }, readyUrl: `http://127.0.0.1:${port}/` },
			baseUrl: `http://127.0.0.1:${port}`,
			checks: [{ name: "items", method: "GET", path: "/items", expectStatus: 200 }],
		},
		{ "server.cjs": server },
	);
	const r = await main(["--root", dir, "--check", "items", "--repeat", "9"]);
	assert.equal(r.code, 1, r.text);
	assert.match(r.text, /RED check items x9: GET \/items -> red in 3 of 9 runs \(33%\)/);
	assert.match(r.text, /3x status 500, expected 200/);
	assert.match(r.text, /first red \(run 3\):\nboom 3/);
	assert.equal(fs.readFileSync(path.join(dir, "starts"), "utf8"), "x", "the server starts once");
});

test("--repeat counts runs that could not start as red and inconclusive", async () => {
	const dir = project({ checks: [{ name: "gone", args: ["stack-agent-no-such-program"] }] });
	const r = await main(["--root", dir, "--check", "gone", "--repeat", "2"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /red in 2 of 2 runs \(100%\), 2 of them inconclusive/);
	assert.equal(latest(dir).steps[0].inconclusive, 2);
});

test("--repeat refuses what it cannot do", async () => {
	const dir = project({ test: { args: [node, "-v"] }, checks: [{ name: "a", args: [node, "-v"] }] });
	for (const [args, expected] of [
		[["--repeat", "5"], /needs --check NAME/],
		[["--check", "a", "--repeat", "1"], /whole number from 2 to 1000/],
		[["--check", "a", "--repeat", "1001"], /whole number from 2 to 1000/],
		[["--check", "a", "--repeat", "3x"], /whole number from 2 to 1000/],
		[["--check", "a", "--repeat", "3", "--skip-checks"], /cannot be used with --skip-checks/],
		[["--check", "a", "--repeat", "3", "--against", "HEAD"], /never runs the against step/],
		[["--check", "nope", "--repeat", "3"], /unknown check name/],
	])
		await assert.rejects(main(["--root", dir, ...args]), (e) => e instanceof ConfigError && expected.test(e.message), String(expected));
});
