// The full+superpowers arm: the plugin beside obra/superpowers. It passes both folders to claude, needs to be told
// which superpowers to load, and counts as isolated only with exactly those two plugins.
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { ARMS, checkIsolation, claudeArgs, claudeEnv, makeArmPlugin } from "../scripts/ab/lib.mjs";
import { parseOptions } from "../scripts/ab/run.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { repoRoot, tempDir, write } from "./helpers.mjs";

const fakeSuperpowers = () => {
	const dir = tempDir("stack-agent-sp-");
	write(dir, ".claude-plugin/plugin.json", JSON.stringify({ name: "superpowers", version: "7.0.0" }));
	return dir;
};
const parsedWith = (plugins) => ({ init: { plugins: plugins.map((name) => ({ name, source: `${name}@local` })), skills: ["stack-agent:debug"] }, events: [], tools: [], feedback: [] });

test("the arm passes both plugin folders to claude", () => {
	assert.ok(ARMS.includes("full+superpowers"));
	const sp = fakeSuperpowers();
	const dirs = makeArmPlugin("full+superpowers", repoRoot, tempDir(), { superpowers: sp });
	assert.deepEqual(dirs, [repoRoot, sp]);
	const args = claudeArgs({ prompt: "p", model: "m", budget: 1, pluginDir: dirs, isolate: true });
	const at = args.flatMap((a, i) => (a === "--plugin-dir" ? [args[i + 1]] : []));
	assert.deepEqual(at, [repoRoot, sp]);
	assert.deepEqual(claudeArgs({ prompt: "p", model: "m", budget: 1, pluginDir: repoRoot, isolate: true }).filter((a) => a === "--plugin-dir").length, 1, "one folder as before");
	assert.throws(() => makeArmPlugin("full+superpowers", repoRoot, tempDir()), /needs --superpowers DIR/);
});

test("the arm is isolated only with stack-agent and superpowers loaded, and nothing else", () => {
	assert.equal(checkIsolation({ arm: "full+superpowers", parsed: parsedWith(["stack-agent", "superpowers"]), isolate: true }).ok, true);
	assert.match(checkIsolation({ arm: "full+superpowers", parsed: parsedWith(["stack-agent"]), isolate: true }).reasons.join(), /superpowers did not load/);
	assert.match(checkIsolation({ arm: "full+superpowers", parsed: parsedWith(["stack-agent", "superpowers", "other"]), isolate: true }).reasons.join(), /loaded other plugins: other/);
	assert.match(checkIsolation({ arm: "full", parsed: parsedWith(["stack-agent", "superpowers"]), isolate: true }).reasons.join(), /loaded other plugins: superpowers/, "the plain plugin arm still refuses it");
});

test("--superpowers must name a superpowers plugin, and the arm requires it; every arm turns superpowers telemetry off", () => {
	const base = ["--task", "endpoint", "--model", "m", "--budget", "1"];
	assert.throws(() => parseOptions([...base, "--arms", "full+superpowers"]), (e) => e instanceof ConfigError && /needs --superpowers DIR/.test(e.message));
	const notIt = tempDir("stack-agent-sp-");
	write(notIt, ".claude-plugin/plugin.json", JSON.stringify({ name: "something-else" }));
	assert.throws(() => parseOptions([...base, "--superpowers", notIt]), /is not a superpowers plugin/);
	const sp = fakeSuperpowers();
	assert.equal(parseOptions([...base, "--arms", "full,full+superpowers", "--superpowers", sp]).superpowers, path.resolve(sp));
	assert.equal(claudeEnv(true, {}).env.SUPERPOWERS_DISABLE_TELEMETRY, "1");
});
