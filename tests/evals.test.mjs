// The eval cases can only be run by `claude plugin eval` (and the Bash ones only on Linux, macOS, or WSL2), so
// these tests check what can be checked here: every case is well formed, and the setup scripts plant the state
// the graders expect.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { scaffold } from "../evals/scaffold.mjs";
import { git, repoRoot, runNode, tempDir } from "./helpers.mjs";

const evalsDir = path.join(repoRoot, "evals");
const cases = fs.readdirSync(evalsDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "results").map((d) => d.name);
const GRADER_TYPES = ["llm", "regex", "tool_used", "file_exists"];
const frontmatter = (text) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? null;

test("every eval case has a case.yaml named after its folder, a prompt with allowed tools, a scaffold, and graders", () => {
	assert.ok(cases.length >= 7, cases.join(", "));
	for (const name of cases) {
		const dir = path.join(evalsDir, name);
		const caseYaml = fs.readFileSync(path.join(dir, "case.yaml"), "utf8");
		assert.match(caseYaml, /^schema_version: "1\.1"$/m, name);
		assert.match(caseYaml, new RegExp(`^name: ${name}$`, "m"), name);
		assert.match(caseYaml, /^ {2}scaffold_script: scaffold\.sh$/m, name);
		const prompt = fs.readFileSync(path.join(dir, "prompt.md"), "utf8");
		assert.match(frontmatter(prompt) ?? "", /^allowed_tools: \[.+\]$/m, `${name}: prompt.md lists its tools`);
		const scaffoldSh = fs.readFileSync(path.join(dir, "scaffold.sh"), "utf8");
		assert.match(scaffoldSh, /node "\$\(dirname "\$0"\)\/\.\.\/scaffold\.mjs"/, name);
		if (fs.existsSync(path.join(dir, "setup.mjs"))) assert.match(scaffoldSh, /setup\.mjs/, `${name}: scaffold.sh runs its setup.mjs`);
		const graders = fs.readdirSync(path.join(dir, "graders"));
		assert.ok(graders.length >= 2, name);
		for (const g of graders) {
			const fm = frontmatter(fs.readFileSync(path.join(dir, "graders", g), "utf8"));
			assert.ok(fm, `${name}/${g} has frontmatter`);
			assert.ok(GRADER_TYPES.includes(/^type: (\S+)$/m.exec(fm)?.[1]), `${name}/${g} type`);
		}
	}
});

test("a skill a person must start is started by name in its eval prompt", () => {
	for (const [name, skill] of [["correct-error-body", "correct"], ["reflect-lessons", "reflect"]]) {
		assert.match(fs.readFileSync(path.join(repoRoot, "skills", skill, "SKILL.md"), "utf8"), /^disable-model-invocation: true$/m);
		assert.match(fs.readFileSync(path.join(evalsDir, name, "prompt.md"), "utf8"), new RegExp(`^/stack-agent:${skill}\\b`, "m"), name);
	}
});

function scaffolded(name) {
	const dir = tempDir("stack-agent-eval-");
	scaffold(dir, repoRoot);
	const r = runNode(path.join(evalsDir, name, "setup.mjs"), [], { cwd: dir });
	assert.equal(r.code, 0, r.stderr);
	return dir;
}

test("debug-blank-name plants the bug in a commit, so the fix grader fails until the agent fixes it", () => {
	const dir = scaffolded("debug-blank-name");
	assert.match(git(dir, "log", "-1", "--format=%s"), /items: take the name as sent/);
	assert.equal(git(dir, "status", "--porcelain"), "");
	const service = fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8");
	const pattern = new RegExp(/^pattern: '(.+)'$/m.exec(fs.readFileSync(path.join(evalsDir, "debug-blank-name/graders/fix-in-service.md"), "utf8"))[1]);
	assert.doesNotMatch(service, pattern);
	assert.match(fs.readFileSync(path.join(repoRoot, "examples/sample-backend/src/modules/items/service.js"), "utf8"), pattern, "the correct code matches");
});

test("correct-error-body leaves the same mistake and its review fix twice in history, and clean code at the end", () => {
	const dir = scaffolded("correct-error-body");
	const log = git(dir, "log", "--format=%s").trim().split("\n");
	assert.deepEqual(log.slice(0, 4), ["fix: error bodies use { error } again, per review", "items: show the reason to the client", "fix: error bodies use { error }, per review", "items: friendlier error body"]);
	assert.match(fs.readFileSync(path.join(dir, "src/modules/items/controller.js"), "utf8"), /\{ error: result\.error \}/);
	assert.match(git(dir, "show", "HEAD~1:src/modules/items/controller.js"), /\{ message: result\.error \}/);
});

test("sample-review has no eval case on purpose: its checkout cannot be made in the eval sandbox", () => {
	assert.ok(!cases.some((c) => /sample-review|review-spec/.test(c)));
	assert.match(fs.readFileSync(path.join(repoRoot, "skills/run-evals/SKILL.md"), "utf8"), /sample-review/);
});

// Where the plugin's Stop hook keeps the agent on verification, as in the eval sandbox where .stack-agent/ is
// read-only, the final message becomes a verification report and the skill's work sits earlier in the trace. A
// grader about that work must read the trace (found in the WSL2 run of 2026-10-23: correct-error-body 0.5 with the
// plugin, 0.75 without, both losses on final-message graders).
test("llm graders about a skill's own output read the trace, not only the final message", () => {
	const focus = (name, grader) => /^focus: (\S+)$/m.exec(frontmatter(fs.readFileSync(path.join(evalsDir, name, "graders", grader), "utf8")) ?? "")?.[1] ?? null;
	for (const grader of ["cites-history.md", "rule-names-the-fix.md"]) assert.equal(focus("correct-error-body", grader), "trace", grader);
	for (const [name, grader] of [["debug-blank-name", "repro-before-fix.md"], ["debug-blank-name", "repro-kept.md"], ["correct-error-body", "proof-or-honest.md"], ["correct-error-body", "no-loosening.md"]])
		assert.equal(focus(name, grader), "trace", `${name}/${grader}`);
	assert.match(fs.readFileSync(path.join(evalsDir, "correct-error-body/graders/cites-history.md"), "utf8"), /FAIL if they cite only one of the two/);
});
