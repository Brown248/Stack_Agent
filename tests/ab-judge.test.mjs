import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { scaffold } from "../evals/scaffold.mjs";
import { blindCopy, judgeArgs, judgeInstructions, judgeKey, judgePrompt, parseJudge, runJudge } from "../scripts/ab/judge.mjs";
import { parseOptions } from "../scripts/ab/run.mjs";
import { git, repoRoot, tempDir, write } from "./helpers.mjs";

const RUBRIC = ["The controller only parses the request", "SQL is in the repository"];

test("parseJudge reads the judge's table, matching criteria by text, then by position", () => {
	const table = `Candidate: A
| Criterion | Verdict | Evidence |
| --- | --- | --- |
| The controller only parses the request | PASS | src/modules/items/controller.js:12 |
| SQL is in the repository | **FAIL** | service.js:4 runs DELETE |
Score: 1/2`;
	assert.deepEqual(parseJudge(table, RUBRIC), { [judgeKey(RUBRIC[0])]: true, [judgeKey(RUBRIC[1])]: false });
	// numbered or reworded criteria fall back to their position when the row count matches
	const numbered = "| 1. controller | FAIL | x |\n| 2. sql | PASS | y |";
	assert.deepEqual(Object.values(parseJudge(numbered, RUBRIC)), [false, true]);
	// a missing answer is null, not a fail
	assert.deepEqual(Object.values(parseJudge("| SQL is in the repository | PASS | y |", RUBRIC)), [null, true]);
	assert.deepEqual(Object.values(parseJudge("no table at all", RUBRIC)), [null, null]);
});

test("judgeKey gives short, stable grader names", () => {
	assert.equal(judgeKey("The controller only parses the request"), "judge:the-controller-only-parses-the-request");
	assert.ok(judgeKey("x".repeat(100)).length <= 46);
});

test("the judge runs with agents/judge.md as instructions, read-only tools, and no plugin", () => {
	const instructions = judgeInstructions(repoRoot);
	assert.match(instructions, /^You are a judge\./);
	assert.doesNotMatch(instructions, /^---/);
	const args = judgeArgs({ prompt: judgePrompt(RUBRIC), model: "haiku", budget: 0.5, instructions });
	assert.equal(args[args.indexOf("--allowedTools") + 1], "Read,Glob,Grep");
	assert.equal(args[args.indexOf("--append-system-prompt") + 1], instructions);
	assert.ok(!args.includes("--plugin-dir"));
	assert.ok(args.includes("--strict-mcp-config"));
	assert.match(args[1], /1\. The controller only parses the request\n2\. SQL is in the repository$/);
});

function agentRun() {
	const dir = tempDir("stack-agent-ab-");
	scaffold(dir, repoRoot);
	// what an agent leaves behind: a code change, a new file, and the harness traces that would tell the arm
	write(dir, "src/modules/items/service.js", fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8") + "// changed by the agent\n");
	write(dir, "src/modules/items/extra.js", "export const extra = 1;\n");
	write(dir, ".stack-agent/evidence/latest.json", "{}");
	write(dir, ".stack-agent/verify-skip.json", '{"reason":"no time"}');
	write(dir, ".stack-agent/verify.json", fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8").replace('"checks": [', '"checks": [{"name":"x","method":"GET","path":"/","expectStatus":200},'));
	return dir;
}

test("the blind copy has a random name, the change as CHANGES.diff, and nothing that tells the arm", () => {
	const dir = agentRun();
	const statusBefore = git(dir, "status", "--porcelain");
	const out = tempDir("stack-agent-judge-out-");
	const copy = blindCopy(dir, out);
	assert.match(path.basename(copy), /^[0-9a-f]{16}$/);
	assert.ok(fs.existsSync(path.join(copy, "src/modules/items/service.js")));
	assert.ok(fs.existsSync(path.join(copy, ".stack-agent/rules.md")), "team rules stay for the rubric");
	for (const hidden of [".stack-agent/evidence", ".stack-agent/verify-skip.json", ".stack-agent/verify.json", ".stack-agent/bin", ".git"]) assert.ok(!fs.existsSync(path.join(copy, hidden)), hidden);
	const diff = fs.readFileSync(path.join(copy, "CHANGES.diff"), "utf8");
	assert.match(diff, /\+\/\/ changed by the agent/);
	assert.match(diff, /src\/modules\/items\/extra\.js/);
	assert.doesNotMatch(diff, /\.stack-agent/);
	assert.equal(git(dir, "status", "--porcelain"), statusBefore, "the project's index is left alone");
});

test("the diff starts at the planted bug's commit for a bug task", () => {
	const dir = agentRun();
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "planted bug");
	git(dir, "tag", "ab-start");
	write(dir, "src/modules/items/fix.js", "export const fix = 1;\n");
	const diff = fs.readFileSync(path.join(blindCopy(dir, tempDir("stack-agent-judge-out-")), "CHANGES.diff"), "utf8");
	assert.match(diff, /fix\.js/);
	assert.doesNotMatch(diff, /extra\.js/, "changes before ab-start are the task's setup, not the agent's");
});

test("runJudge scores the rubric from the judge session's final answer", () => {
	const dir = agentRun();
	const calls = [];
	const spawn = (claude, args, cwd) => {
		calls.push({ args, cwd });
		const result = { type: "result", result: `| ${RUBRIC[0]} | PASS | a |\n| ${RUBRIC[1]} | FAIL | b |`, total_cost_usd: 0.02, num_turns: 3 };
		return { status: 0, stdout: JSON.stringify(result) + "\n" };
	};
	const j = runJudge({ claude: {}, spawn, projectDir: dir, outDir: tempDir("stack-agent-judge-out-"), rubric: RUBRIC, model: "haiku", budget: 0.5, pluginDir: repoRoot, isolate: true });
	assert.deepEqual(Object.values(j.grade), [true, false]);
	assert.equal(j.usage.cost, 0.02);
	assert.equal(calls[0].cwd, j.folder);
	assert.notEqual(path.resolve(calls[0].cwd), path.resolve(dir));
});

test("run.mjs takes --judge MODEL, off by default", () => {
	const base = ["--task", "endpoint", "--model", "sonnet", "--budget", "1", "--out", tempDir("stack-agent-ab-out-")];
	assert.equal(parseOptions(base).judge, null);
	assert.equal(parseOptions([...base, "--judge", "haiku"]).judge, "haiku");
});

test("tasks with a rubric ask yes/no questions about the code", async () => {
	for (const name of ["endpoint", "item-note", "dup-name"]) {
		const { rubric } = await import(`../scripts/ab/tasks/${name}.mjs`);
		assert.ok(Array.isArray(rubric) && rubric.length > 0, name);
		for (const c of rubric) assert.ok(typeof c === "string" && c.length > 20 && !/verif/i.test(c), `${name}: ${c}`);
	}
});
