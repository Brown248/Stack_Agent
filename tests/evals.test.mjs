// The eval cases can only be run by `claude plugin eval` (and the Bash ones only on Linux, macOS, or WSL2), so
// these tests check what can be checked here: every case is well formed, and the setup scripts plant the state
// the graders expect.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { scaffold } from "../evals/scaffold.mjs";
import { main } from "../scripts/feature-map.mjs";
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
		// claude's YAML reader refuses a plain value holding ": ", " #", or a trailing ":", which a looser reader here would not notice
		for (const [, key, v] of caseYaml.matchAll(/^\s*([\w-]+): (.+)$/gm)) if (!/^["'[{|>]/.test(v)) assert.ok(!v.includes(": ") && !v.includes(" #") && !v.endsWith(":"), `${name}: ${key} needs quotes around its value`);
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

test("reflect-reconcile plants the older line the new correction contradicts, in a project skill the correction does not route to", () => {
	const dir = scaffolded("reflect-reconcile");
	assert.match(git(dir, "log", "-1", "--format=%s"), /quick-lookup keeps one-line queries in the controller/);
	assert.equal(git(dir, "status", "--porcelain"), "");
	const skill = fs.readFileSync(path.join(dir, ".claude/skills/quick-lookup/SKILL.md"), "utf8");
	assert.match(skill, /^name: quick-lookup$/m);
	assert.match(skill, /A query of one SELECT may stay in the controller/);
	// the grader asks for exactly that line, and the prompt starts the skill by name
	assert.match(fs.readFileSync(path.join(evalsDir, "reflect-reconcile/graders/rewrites-the-old-rule.md"), "utf8"), /quick-lookup/);
	assert.match(fs.readFileSync(path.join(evalsDir, "reflect-reconcile/prompt.md"), "utf8"), /^\/stack-agent:reflect\b/m);
});

test("debug-blank-name plants the bug in a commit, so the fix grader fails until the agent fixes it", () => {
	const dir = scaffolded("debug-blank-name");
	assert.match(git(dir, "log", "-1", "--format=%s"), /items: take the name as sent/);
	assert.equal(git(dir, "status", "--porcelain"), "");
	const service = fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8");
	const pattern = new RegExp(/^pattern: '(.+)'$/m.exec(fs.readFileSync(path.join(evalsDir, "debug-blank-name/graders/fix-in-service.md"), "utf8"))[1]);
	assert.doesNotMatch(service, pattern);
	assert.match(fs.readFileSync(path.join(repoRoot, "examples/sample-backend/src/modules/items/service.js"), "utf8"), pattern, "the correct code matches");
});

test("code-review-finds-bug plants a commit whose code lets 500 characters through where its spec says 50, and the left-unchanged grader fails once it is fixed", () => {
	const dir = scaffolded("code-review-finds-bug");
	assert.match(git(dir, "log", "-1", "--format=%s"), /items: refuse long names/);
	assert.equal(git(dir, "rev-list", "--count", "HEAD").trim(), "2", "a base commit and the commit under review (HEAD~1 exists)");
	assert.equal(git(dir, "status", "--porcelain"), "");
	assert.match(fs.readFileSync(path.join(dir, "specs/name-limit.md"), "utf8"), /longer than 50 characters/);
	const service = fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8");
	const pattern = new RegExp(/^pattern: '(.+)'$/m.exec(fs.readFileSync(path.join(evalsDir, "code-review-finds-bug/graders/left-code-unchanged.md"), "utf8"))[1]);
	assert.match(service, pattern, "the planted code matches, so a review that leaves it alone passes");
	assert.doesNotMatch(service.replace("> 500", "> 50"), pattern, "a fix would not match");
});

test("debug-loop-first starts from the same planted bug as debug-blank-name", () => {
	const dir = scaffolded("debug-loop-first");
	assert.match(git(dir, "log", "-1", "--format=%s"), /items: take the name as sent/);
	assert.doesNotMatch(fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8"), /name\.trim\(\)/);
	assert.equal(fs.readFileSync(path.join(evalsDir, "debug-loop-first/graders/fix-in-service.md"), "utf8"), fs.readFileSync(path.join(evalsDir, "debug-blank-name/graders/fix-in-service.md"), "utf8"));
});

test("feature-map-repair moves the module and renames the function in a commit, and leaves a map the graders reject until it is repaired", () => {
	const dir = tempDir("stack-agent-eval-");
	scaffold(dir, repoRoot, "sample-cli");
	assert.equal(runNode(path.join(evalsDir, "feature-map-repair/setup.mjs"), [], { cwd: dir }).code, 0);
	assert.match(git(dir, "log", "-1", "--format=%s"), /let an unreadable file raise/);
	assert.match(git(dir, "log", "-2", "--format=%s"), /move the counting into counting\.py/);
	assert.equal(git(dir, "status", "--porcelain"), "");
	assert.doesNotMatch(fs.readFileSync(path.join(dir, "wordfreq/cli.py"), "utf8"), /cannot read/, "the code behind the Explain row is gone");
	assert.ok(fs.existsSync(path.join(dir, "wordfreq/counting.py")) && !fs.existsSync(path.join(dir, "wordfreq/core.py")));
	assert.match(fs.readFileSync(path.join(dir, "wordfreq/counting.py"), "utf8"), /def most_common_words/);
	const map = fs.readFileSync(path.join(dir, ".stack-agent/feature-map.md"), "utf8");
	const pattern = (g) => new RegExp(/^pattern: '(.+)'$/m.exec(fs.readFileSync(path.join(evalsDir, "feature-map-repair/graders", g), "utf8"))[1]);
	assert.doesNotMatch(map, pattern("map-names-new-file.md"));
	assert.doesNotMatch(map, pattern("map-names-new-function.md"));
	assert.doesNotMatch(map, pattern("old-names-gone.md"), "the map still names the old file, so the old-names grader fails");
	// the same graders pass on a repaired map, and the repaired map passes the tool
	const fixed = map.replaceAll("wordfreq/core.py", "wordfreq/counting.py").replaceAll("def top_words", "def most_common_words");
	assert.match(fixed, pattern("map-names-new-file.md"));
	assert.match(fixed, pattern("map-names-new-function.md"));
	assert.match(fixed, pattern("old-names-gone.md"));
	fs.writeFileSync(path.join(dir, ".stack-agent/feature-map.md"), fixed);
	const left = main(["--root", dir]);
	assert.equal(left.code, 1, "one problem is left: the row whose code is gone");
	assert.match(left.text, /Explain a file that cannot be read: wordfreq\/cli\.py no longer contains/);
	assert.match(left.text, /DRIFT \(1 problem/);
	fs.writeFileSync(path.join(dir, ".stack-agent/feature-map.md"), fixed.split("\n").filter((l) => !l.startsWith("| Explain a file")).join("\n"));
	assert.equal(main(["--root", dir]).code, 0);
	fs.writeFileSync(path.join(dir, ".stack-agent/feature-map.md"), map);
	assert.equal(main(["--root", dir, "--suggest"]).code, 1);
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

// A judge that sees only the final message cannot check a claim against the trace. In the WSL2 run of 2026-10-24,
// honest-report (which says "the trace shows") failed three plugin runs whose final message said verify could not
// run and why, as its PASS clause asks.
test("an llm grader that judges against the trace reads the trace, and honest-report accepts an honest partial report", () => {
	for (const name of cases) {
		for (const g of fs.readdirSync(path.join(evalsDir, name, "graders"))) {
			const text = fs.readFileSync(path.join(evalsDir, name, "graders", g), "utf8");
			const fm = frontmatter(text) ?? "";
			if (!/^type: llm$/m.test(fm) || !/\btrace\b/i.test(text.slice(fm.length))) continue;
			assert.match(fm, /^focus: trace$/m, `${name}/${g} mentions the trace but reads only the final message`);
		}
		const honest = path.join(evalsDir, name, "graders", "honest-report.md");
		if (fs.existsSync(honest)) assert.match(fs.readFileSync(honest, "utf8"), /next to saying verify could not run is honest/, `${name}/honest-report.md`);
	}
});
