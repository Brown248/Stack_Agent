import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main } from "../scripts/verify.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { processGone, tempDir, write } from "./helpers.mjs";

function project(config, files = {}) {
	const dir = tempDir("stack-agent-cmd-");
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	write(dir, ".stack-agent/verify.json", JSON.stringify(config));
	return dir;
}

const greet = { "greet.cjs": 'const name = process.argv[2] ?? "world";\nif (name === "fail") { console.error("bad name"); process.exit(3); }\nconsole.log(`hello ${name}`);\n' };

test("command checks run without a server or baseUrl and pass on exit code and output", async () => {
	const dir = project(
		{
			checks: [
				{ name: "greets", command: "node greet.cjs Ada", expectOutputIncludes: "hello Ada" },
				{ name: "greets-default", type: "command", command: "node greet.cjs", expectOutputMatches: "^hello world$" },
				{ name: "rejects", command: "node greet.cjs fail", expectExit: 3, expectOutputIncludes: "bad name", expectOutputExcludes: "hello" },
			],
		},
		greet,
	);
	const r = await main(["--root", dir]);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /PASS check greets: node greet\.cjs Ada -> exit 0/);
	const latest = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8"));
	assert.equal(latest.ok, true);
	assert.equal(latest.full, true);
	assert.deepEqual(latest.steps.filter((s) => s.step === "check").map((s) => s.type), ["command", "command", "command"]);
	assert.equal(latest.steps.at(-1).skipped, "not a git repository");
});

test("command checks report wrong exit codes, missing output, and unwanted output", async () => {
	const dir = project(
		{
			checks: [
				{ name: "exit", command: "node greet.cjs fail" },
				{ name: "missing", command: "node greet.cjs Ada", expectOutputIncludes: "goodbye" },
				{ name: "unwanted", command: "node greet.cjs Ada", expectOutputExcludes: "hello" },
				{ name: "regex", command: "node greet.cjs Ada", expectOutputMatches: "^bye" },
			],
		},
		greet,
	);
	const r = await main(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /FAIL check exit: .* \(exit 3, expected 0\)/);
	assert.match(r.text, /FAIL check missing: .* \(output does not include "goodbye"\)/);
	assert.match(r.text, /FAIL check unwanted: .* \(output includes "hello"\)/);
	assert.match(r.text, /FAIL check regex: .* \(output does not match \/\^bye\/m\)/);
});

test("a command check that hangs is timed out and killed", async () => {
	const dir = project(
		{ checks: [{ name: "hang", command: "node hang.cjs", timeoutSec: 1 }] },
		{ "hang.cjs": 'require("fs").writeFileSync("hang.pid", String(process.pid));\nsetInterval(() => {}, 1000);\n' },
	);
	const r = await main(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /timed out after 1s/);
	assert.ok(await processGone(path.join(dir, "hang.pid")), "the process must be killed");
});

test("command checks can set cwd and env", async () => {
	const dir = project(
		{ checks: [{ name: "env", command: "node show.cjs", cwd: "sub", env: { STACK_AGENT_DEMO: "from-config" }, expectOutputIncludes: "sub:from-config" }] },
		{ "sub/show.cjs": 'console.log(require("path").basename(process.cwd()) + ":" + process.env.STACK_AGENT_DEMO);\n' },
	);
	const r = await main(["--root", dir]);
	assert.equal(r.code, 0, r.text);
});

test("http and command checks can be mixed, and --check filters across both", async () => {
	const dir = project({ baseUrl: "http://127.0.0.1:9", checks: [{ name: "cli", command: "node greet.cjs" }, { name: "api", method: "GET", path: "/", expectStatus: 200 }] }, greet);
	const only = await main(["--root", dir, "--check", "cli"]);
	assert.equal(only.code, 0, only.text);
	assert.match(only.text, /partial run/);
});

test("bad command check configs are config errors", async () => {
	const cases = [
		[{ checks: [{ name: "x", type: "command" }] }, /command checks need a command string/],
		[{ checks: [{ name: "x", command: "node -v", expectExit: "0" }] }, /expectExit must be an integer/],
		[{ checks: [{ name: "x", command: "node -v", expectOutputMatches: "(" }] }, /bad expectOutputMatches/],
		[{ checks: [{ name: "x", type: "ftp", command: "x" }] }, /type must be one of http, command/],
		[{ checks: [{ name: "x", method: "GET", path: "/", expectStatus: 200 }] }, /needs baseUrl when it has http checks/],
		[{ checks: "nope" }, /checks must be an array/],
	];
	for (const [config, expected] of cases) {
		await assert.rejects(main(["--root", project(config)]), (e) => e instanceof ConfigError && expected.test(e.message), String(expected));
	}
});
