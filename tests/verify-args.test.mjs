import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main } from "../scripts/verify.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { freePort, tempDir, write } from "./helpers.mjs";

function project(config, files = {}) {
	const dir = tempDir("stack-agent-args-");
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	write(dir, ".stack-agent/verify.json", JSON.stringify(config));
	return dir;
}

const node = process.execPath;
const tricky = `it's "quoted" & <spaced> | 100%`;

test("args reach the program exactly as written, quotes and spaces included, on every OS", async () => {
	const dir = project({
		test: { args: [node, "-e", "console.log(process.argv.slice(1).join('|'))", tricky, ""] },
		checks: [
			{ name: "inline", args: [node, "-e", 'console.log("hello, \\"world\\"")'], expectOutputIncludes: 'hello, "world"' },
			{ name: "argv", args: [node, "-e", "console.log(JSON.stringify(process.argv.slice(1)))", tricky, "a b", ""], expectOutputIncludes: JSON.stringify([tricky, "a b", ""]) },
			{ name: "exit", args: [node, "-e", "process.exit(4)"], expectExit: 4 },
		],
	});
	const r = await main(["--root", dir]);
	assert.equal(r.code, 0, r.text);
	const latest = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8"));
	assert.equal(latest.ok, true);
	assert.equal(latest.steps[0].step, "tests");
	assert.match(latest.steps[0].output, /it's "quoted" & <spaced> \| 100%\|/);
	const argv = latest.steps.find((s) => s.name === "argv");
	assert.equal(argv.type, "command");
	assert.equal(argv.request, argv.args.join(" "));
	assert.deepEqual(argv.args.slice(-3), [tricky, "a b", ""]);
});

test("args checks honor cwd and env", async () => {
	const dir = project(
		{ checks: [{ name: "env", args: [node, "show.cjs"], cwd: "sub dir", env: { STACK_AGENT_DEMO: "from config" }, expectOutputIncludes: "sub dir:from config" }] },
		{ "sub dir/show.cjs": 'console.log(require("path").basename(process.cwd()) + ":" + process.env.STACK_AGENT_DEMO);\n' },
	);
	const r = await main(["--root", dir]);
	assert.equal(r.code, 0, r.text);
});

test("an args check that hangs is timed out and killed", async () => {
	const dir = project(
		{ checks: [{ name: "hang", args: [node, "hang.cjs"], timeoutSec: 1 }] },
		{ "hang.cjs": 'require("fs").writeFileSync("hang.pid", String(process.pid));\nsetInterval(() => {}, 1000);\n' },
	);
	const r = await main(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /timed out after 1s/);
	const pid = Number(fs.readFileSync(path.join(dir, "hang.pid"), "utf8"));
	await new Promise((res) => setTimeout(res, 300));
	assert.throws(() => process.kill(pid, 0), /ESRCH/);
});

test("a program that cannot start fails the check with a clear reason", async () => {
	const dir = project({ checks: [{ name: "missing", args: ["stack-agent-no-such-program", "--version"] }] });
	const r = await main(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /FAIL check missing: .*could not start "stack-agent-no-such-program": ENOENT\./);
	if (process.platform === "win32") assert.match(r.text, /npm, npx, and other \.cmd or \.bat scripts need "command"/);
	else assert.match(r.text, /installed and on PATH/);
});

test("on Windows a .cmd script given as args is refused with a pointer to command", { skip: process.platform !== "win32" }, async () => {
	const dir = project({ test: { args: ["tool.cmd"] } }, { "tool.cmd": "@echo hi\r\n" });
	const r = await main(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /FAIL tests: tool\.cmd .*\n.*could not start "tool\.cmd": (EINVAL|ENOENT)\..*need "command" instead of "args"/);
});

test("a server can be started from args", async () => {
	const port = await freePort();
	const dir = project(
		{
			server: { args: [node, "server.cjs"], env: { PORT: String(port) }, readyUrl: `http://127.0.0.1:${port}/` },
			baseUrl: `http://127.0.0.1:${port}`,
			checks: [{ name: "home", method: "GET", path: "/", expectStatus: 200, expectBodyIncludes: "ok" }],
		},
		{ "server.cjs": 'require("http").createServer((q, s) => s.end("ok")).listen(Number(process.env.PORT), "127.0.0.1");\n' },
	);
	const r = await main(["--root", dir]);
	assert.equal(r.code, 0, r.text);
	const missing = project({ server: { args: ["stack-agent-no-such-server"], readyUrl: `http://127.0.0.1:${port}/` }, baseUrl: `http://127.0.0.1:${port}`, checks: [{ name: "home", method: "GET", path: "/", expectStatus: 200 }] });
	const m = await main(["--root", missing]);
	assert.equal(m.code, 1);
	assert.match(m.text, /FAIL server: could not start "stack-agent-no-such-server": ENOENT/);
});

test("bad args configs are config errors", async () => {
	const cases = [
		[{ checks: [{ name: "x", command: "node -v", args: ["node", "-v"] }] }, /give command or args, not both/],
		[{ checks: [{ name: "x", args: [] }] }, /args must be a non-empty array of strings/],
		[{ checks: [{ name: "x", args: "node -v" }] }, /args must be a non-empty array of strings/],
		[{ checks: [{ name: "x", args: ["node", 1] }] }, /args must be a non-empty array of strings/],
		[{ checks: [{ name: "x", args: [""] }] }, /args must be a non-empty array of strings/],
		[{ test: { command: "npm test", args: ["npm", "test"] } }, /test: give command or args, not both/],
		[{ test: { args: [] } }, /test: args must be a non-empty array of strings/],
		[{ test: { args: ["node", "-v"] }, server: { readyUrl: "http://127.0.0.1:9/" } }, /server needs a command string or an args array/],
		[{ test: { args: ["node", "-v"] }, server: { command: "x", args: ["x"], readyUrl: "http://127.0.0.1:9/" } }, /server: give command or args, not both/],
	];
	for (const [config, expected] of cases) {
		await assert.rejects(main(["--root", project(config)]), (e) => e instanceof ConfigError && expected.test(e.message), String(expected));
	}
});
