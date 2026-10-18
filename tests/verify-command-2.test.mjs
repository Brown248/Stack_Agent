import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main } from "../scripts/verify.mjs";
import { freePort, tempDir, write } from "./helpers.mjs";

function project(config, files = {}) {
	const dir = tempDir("stack-agent-cmd2-");
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	write(dir, ".stack-agent/verify.json", JSON.stringify(config));
	return dir;
}

const noisy = {
	"noisy.cjs": 'console.log("HEADER");\nconsole.error("Error: early failure");\nfor (let i = 0; i < 2000; i++) console.log("x".repeat(80));\nconsole.log("FOOTER");\n',
};

test("command checks match against the whole output, not just the tail", async () => {
	const dir = project(
		{
			checks: [
				{ name: "head", command: "node noisy.cjs", expectOutputIncludes: "HEADER" },
				{ name: "foot", command: "node noisy.cjs", expectOutputIncludes: "FOOTER" },
				{ name: "early-error", command: "node noisy.cjs", expectOutputExcludes: "Error:" },
			],
		},
		noisy,
	);
	const r = await main(["--root", dir]);
	assert.equal(r.code, 1, r.text);
	assert.match(r.text, /PASS check head/);
	assert.match(r.text, /PASS check foot/);
	assert.match(r.text, /FAIL check early-error: .* \(output includes "Error:"\)/);
});

test("expectOutputFlags controls the regex flags", async () => {
	const dir = project({ checks: [{ name: "ci", command: "node -v", expectOutputMatches: "^V\\d+", expectOutputFlags: "i" }, { name: "cs", command: "node -v", expectOutputMatches: "^V\\d+" }] });
	const r = await main(["--root", dir]);
	assert.match(r.text, /PASS check ci/);
	assert.match(r.text, /FAIL check cs: .*does not match \/\^V\\d\+\/m/);
});

test("command-only runs do not start the server, but needsServer does", async () => {
	const port = await freePort();
	const server = {
		command: "node server.cjs",
		env: { PORT: String(port) },
		readyUrl: `http://127.0.0.1:${port}/`,
		readyTimeoutSec: 10,
	};
	const files = {
		"server.cjs": 'require("fs").writeFileSync("started.txt", "yes");\nrequire("http").createServer((q, s) => s.end("up")).listen(Number(process.env.PORT), "127.0.0.1");\n',
		"probe.cjs": 'fetch(process.env.TARGET).then((r) => r.text()).then((t) => console.log("got " + t), () => { console.log("no server"); process.exit(1); });\n',
	};
	const dir = project(
		{
			server,
			baseUrl: `http://127.0.0.1:${port}`,
			checks: [
				{ name: "plain", command: "node -v" },
				{ name: "e2e", command: "node probe.cjs", needsServer: true, env: { TARGET: `http://127.0.0.1:${port}/` }, expectOutputIncludes: "got up" },
				{ name: "page", method: "GET", path: "/", expectStatus: 200 },
			],
		},
		files,
	);
	const plain = await main(["--root", dir, "--check", "plain"]);
	assert.equal(plain.code, 0, plain.text);
	assert.doesNotMatch(plain.text, /server/);
	assert.equal(fs.existsSync(path.join(dir, "started.txt")), false, "the server must not start for command-only checks");

	const e2e = await main(["--root", dir, "--check", "e2e"]);
	assert.equal(e2e.code, 0, e2e.text);
	assert.match(e2e.text, /PASS server: ready/);
});

test("needsServer and expectOutputFlags are validated", async () => {
	await assert.rejects(main(["--root", project({ checks: [{ name: "x", command: "node -v", needsServer: "yes" }] })]), /needsServer must be true or false/);
	await assert.rejects(main(["--root", project({ checks: [{ name: "x", command: "node -v", expectOutputMatches: "a", expectOutputFlags: "zz" }] })]), /bad expectOutputMatches/);
});
