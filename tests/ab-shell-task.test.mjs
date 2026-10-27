// shell-sort: the one-liner sorts but breaks two guard rules, and the after-shell hook reports it; the fix in the
// repository passes every check. The sed edit is reproduced in JavaScript, so the test needs no sed on the machine.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { scaffold } from "../evals/scaffold.mjs";
import * as task from "../scripts/ab/tasks/shell-sort.mjs";
import { freePort, repoRoot, runNode, tempDir } from "./helpers.mjs";

const project = async () => {
	const dir = tempDir("stack-agent-absh-");
	scaffold(dir, repoRoot, "sample-backend", { port: await freePort() });
	return dir;
};
const controller = (dir) => path.join(dir, "src/modules/items/controller.js");
// what the sed in the prompt does
const applyOneLiner = (dir) => {
	const text = fs.readFileSync(controller(dir), "utf8");
	fs.writeFileSync(controller(dir), 'import { db } from "../../db.js";\n' + text.replace("getItems()", 'db().prepare("SELECT id, name FROM items ORDER BY name").all()'));
};

test("shell-sort: the prompt's one-liner sorts, breaks the guard, and the after-shell hook reports it", async () => {
	const dir = await project();
	assert.match(task.prompt, /sed -i .*src\/modules\/items\/controller\.js/);
	applyOneLiner(dir);
	const hook = runNode(path.join(repoRoot, "scripts/hooks/post-bash-guard.mjs"), [], { input: JSON.stringify({ tool_name: "Bash", cwd: dir, session_id: "sh", tool_input: { command: "sed -i ..." } }) });
	assert.equal(hook.code, 2, hook.stderr);
	assert.match(hook.stderr, /that command changed files that now break rules/);
	assert.match(hook.stderr, /\[no-sql-in-controller\]/);
	assert.match(hook.stderr, /\[controller-no-db\]/);

	assert.deepEqual(task.reportedRules(dir), ["controller-no-db", "no-sql-in-controller"], "the hook keeps a record of what it reported");
	const g = await task.grade(dir, { arm: "full" });
	assert.equal(g.checks.behavior, true, g.details.behavior);
	assert.equal(g.checks.guardOk, false);
	assert.equal(g.checks.shellHookFired, true);
});

test("shell-sort: sorting in the repository passes, and the bare arm has no hook to look for", async () => {
	const dir = await project();
	const repo = path.join(dir, "src/modules/items/repository.js");
	fs.writeFileSync(repo, fs.readFileSync(repo, "utf8").replace("ORDER BY id", "ORDER BY name"));
	const g = await task.grade(dir, { arm: "none" });
	assert.equal(g.checks.behavior, true, g.details.behavior);
	assert.equal(g.checks.guardOk, true);
	assert.equal(g.checks.shellHookFired, null);
	assert.equal((await task.grade(dir, { arm: "full" })).checks.shellHookFired, false);
});
