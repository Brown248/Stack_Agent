// init-library: the grader fails the library with Stack Agent taken out, and passes it once a finished setup is back.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { scaffold } from "../evals/scaffold.mjs";
import * as task from "../scripts/ab/tasks/init-library.mjs";
import { repoRoot, runNode, tempDir } from "./helpers.mjs";

test("init-library: the start has no setup, and a finished setup passes every check", async () => {
	const dir = tempDir("stack-agent-abinit-");
	scaffold(dir, repoRoot, task.example);
	task.setup(dir);
	assert.ok(!fs.existsSync(path.join(dir, ".stack-agent")), "the session starts without Stack Agent");
	const before = await task.grade(dir);
	assert.deepEqual(before.checks, { setupComplete: false, verifyPasses: false, guardOk: false, workflow: false });

	// what a finished setup looks like: the example's own configs, with the tools and workflow from init
	fs.cpSync(path.join(repoRoot, "examples", task.example, ".stack-agent"), path.join(dir, ".stack-agent"), { recursive: true, filter: (src) => !/[\\/]evidence([\\/]|$)/.test(src) });
	assert.equal(runNode(path.join(repoRoot, "scripts", "init.mjs"), [dir]).code, 0);
	// the install step the agent fills in: this library has no dependencies
	const workflow = path.join(dir, ".github/workflows/stack-agent.yml");
	fs.writeFileSync(
		workflow,
		fs
			.readFileSync(workflow, "utf8")
			.replace("Install your dependencies (EDIT ME)", "Install dependencies")
			.replace(/ *# EDIT ME: install your dependencies[\s\S]*?echo "EDIT ME: install your dependencies"/, '          echo "no dependencies to install"'),
	);
	const after = await task.grade(dir);
	for (const [k, v] of Object.entries(after.checks)) assert.equal(v, true, `${k}: ${JSON.stringify(after.details)}`);
});
