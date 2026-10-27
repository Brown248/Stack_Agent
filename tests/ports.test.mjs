// freePort hands a test a port to start a server on. The OS gives a port back the moment it is closed, so two test files
// running side by side (node --test runs each file in its own process) could be handed the same one, and a server in
// one answered for the other: "a server that never becomes ready" saw something answer and passed verify (0 !== 1) on
// the Ubuntu runner. Measured on Linux, two processes asking at once got a port in common in 4 of 30 rounds. Each port
// is now claimed with an exclusive file create, in a folder shared by the processes of one test run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { claimPort, freePort } from "./helpers.mjs";

const helpers = new URL("./helpers.mjs", import.meta.url).href;
const child = (code, env = {}) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, ...env } });

// a port number no real run will hand out
const probe = () => 70000 + Math.floor(Math.random() * 100000);

test("a claimed port cannot be claimed again, by this process or by another in the same run", () => {
	const port = probe();
	assert.equal(claimPort(port), true);
	assert.equal(claimPort(port), false, "the same process, again");
	assert.equal(child(`import { claimPort } from ${JSON.stringify(helpers)}; process.stdout.write(String(claimPort(${port})));`).stdout, "false", "another process");
});

test("claims belong to a run: another run's claim on the same port does not block this one", () => {
	const port = probe();
	assert.equal(claimPort(port), true);
	const other = child(`import { claimPort } from ${JSON.stringify(helpers)}; process.stdout.write(String(claimPort(${port})));`, { STACK_AGENT_PORT_SCOPE: `other-run-${process.pid}` });
	assert.equal(other.stdout, "true");
});

test("two processes asking for ports at once never get the same one", async () => {
	const code = `import { freePort } from ${JSON.stringify(helpers)}; const ports = []; for (let i = 0; i < 40; i++) ports.push(await freePort()); process.stdout.write(JSON.stringify(ports));`;
	const [a, b] = [child(code), child(code)].map((r) => JSON.parse(r.stdout));
	assert.equal(new Set([...a, ...b]).size, 80, "80 distinct ports");
	assert.equal(typeof (await freePort()), "number");
});
