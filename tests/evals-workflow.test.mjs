// The evals workflow spends money on the Claude API, so what keeps it from running by itself is tested here: it starts
// only by hand, reads the key from a secret into one place, stops before spending when there is no key, and writes
// nothing to the repository or to a release.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { bash, repoRoot, shPath, tempDir, write } from "./helpers.mjs";

const text = fs.readFileSync(path.join(repoRoot, ".github/workflows/evals.yml"), "utf8").replace(/\r\n/g, "\n");

test("the evals workflow starts only by hand and cannot write to the repository", () => {
	const on = text.slice(text.indexOf("\non:"), text.indexOf("\npermissions:"));
	assert.match(on, /workflow_dispatch:/);
	for (const trigger of ["push:", "pull_request", "schedule:", "workflow_run", "release:"]) assert.ok(!on.includes(trigger), `${trigger} would start a paid run by itself`);
	assert.match(text, /\npermissions:\n {2}contents: read\n/, "read-only token");
	assert.doesNotMatch(text, /contents: write|gh release|git push/, "publishes nothing");
	assert.match(text, /timeout-minutes: \d+/);
	assert.match(text, /--no-publish/, "eval results are not published to a service");
	// the cases that create files (tdd, domain-modeling) and those that run commands need all three tools to be able to pass
	assert.match(text, /--allow-tools Bash Write Edit/);
});

test("the evals workflow reads the API key once, from the secret, and stops before spending without it", () => {
	assert.equal([...text.matchAll(/secrets\./g)].length, 1, "only the API key secret");
	assert.match(text, /ANTHROPIC_API_KEY: \$\{\{ secrets\.ANTHROPIC_API_KEY \}\}/);
	const stop = text.indexOf("Stop if there is no API key");
	const install = text.indexOf("Install Claude Code");
	const run = text.indexOf("Run the eval cases");
	assert.ok(stop > 0 && stop < install && install < run, "the key is checked before anything is installed or run");
	assert.match(text, /exit 1/);
	// inputs reach the shell through env, not by being pasted into the script
	const script = text.slice(run, text.indexOf("Keep the results"));
	assert.doesNotMatch(script, /\$\{\{ *inputs\./, "no input is expanded inside the script");
});

// The shell of a step, run for real with a `claude` that only writes down what it was asked, so the command that would
// spend money is checked without spending any.
function stepScript(title) {
	const lines = text.slice(text.indexOf(`- name: ${title}\n`)).split("\n");
	const at = lines.findIndex((l) => /^ {8}run: \|$/.test(l));
	assert.ok(at > 0, `${title} has a run block`);
	const body = [];
	for (const l of lines.slice(at + 1)) {
		if (l && !l.startsWith(" ".repeat(10))) break;
		body.push(l.slice(10));
	}
	return `${body.join("\n")}\n`;
}

function runStep(title, env) {
	const dir = tempDir("stack-agent-evals-wf-");
	const claude = path.join(dir, "bin", "claude");
	write(dir, "bin/claude", `#!/usr/bin/env bash\necho "--call" >> "${shPath(dir)}/calls.txt"\nprintf '%s\\n' "$@" >> "${shPath(dir)}/calls.txt"\n`);
	fs.chmodSync(claude, 0o755);
	write(dir, "step.sh", stepScript(title));
	const r = spawnSync(bash, [shPath(path.join(dir, "step.sh"))], {
		cwd: dir,
		encoding: "utf8",
		env: { ...process.env, ANTHROPIC_API_KEY: "", PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH}`, RUNNER_TEMP: shPath(dir), ...env },
	});
	const log = fs.existsSync(path.join(dir, "calls.txt")) ? fs.readFileSync(path.join(dir, "calls.txt"), "utf8") : "";
	const calls = log.split("--call\n").filter(Boolean).map((c) => c.trimEnd().split("\n"));
	return { ...r, calls, dir };
}

const skip = bash ? false : "bash is not available";
const RUN = "Run the eval cases";
const base = { CASE: "", RUNS: "3", MAX_COST: "6", ALLOW_TOOLS: "true" };

test("the run step asks for every case with the tools the Bash, Write, and Edit cases need", { skip }, () => {
	const r = runStep(RUN, base);
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(r.calls[0], ["--version"]);
	assert.deepEqual(r.calls[1], ["plugin", "eval", ".", "--scaffold", "--no-publish", "--trust-plugin", "--runs", "3", "--max-cost-usd", "6", "--json", `${shPath(r.dir)}/eval-results.json`, "--allow-tools", "Bash", "Write", "Edit"]);
});

test("the run step passes one case, and leaves the tools out when they are not granted", { skip }, () => {
	const one = runStep(RUN, { ...base, CASE: "code-review-finds-bug", RUNS: "6", MAX_COST: "12" }).calls[1];
	assert.deepEqual(one.slice(one.indexOf("--runs")), ["--runs", "6", "--max-cost-usd", "12", "--json", one[one.indexOf("--json") + 1], "--case", "code-review-finds-bug", "--allow-tools", "Bash", "Write", "Edit"]);
	const none = runStep(RUN, { ...base, ALLOW_TOOLS: "false" }).calls[1];
	assert.ok(!none.includes("--allow-tools"));
});

test("the run step hands a case name to claude as one argument and runs nothing from it", { skip }, () => {
	const dir = tempDir("stack-agent-evals-inj-");
	const r = runStep(RUN, { ...base, CASE: `x; touch ${shPath(dir)}/pwned; echo $(touch ${shPath(dir)}/pwned2)` });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.calls[1][r.calls[1].indexOf("--case") + 1], `x; touch ${shPath(dir)}/pwned; echo $(touch ${shPath(dir)}/pwned2)`);
	assert.ok(!fs.existsSync(path.join(dir, "pwned")) && !fs.existsSync(path.join(dir, "pwned2")));
});

test("the key step fails with a message before anything is installed or run, and passes when the key is there", { skip }, () => {
	const missing = runStep("Stop if there is no API key", {});
	assert.equal(missing.status, 1);
	assert.match(missing.stdout, /::error::add the ANTHROPIC_API_KEY repository secret/);
	assert.equal(missing.calls.length, 0, "claude was not called");
	assert.equal(runStep("Stop if there is no API key", { ANTHROPIC_API_KEY: "test-key-not-real" }).status, 0);
});

test("every case the workflow can name exists in evals/", () => {
	const dirs = fs.readdirSync(path.join(repoRoot, "evals"), { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(repoRoot, "evals", d.name, "case.yaml"))).map((d) => d.name);
	for (const n of ["verify-before-done", "tdd-test-first", "pr-body-shape", "domain-modeling-terms", "code-review-finds-bug", "debug-loop-first"]) assert.ok(dirs.includes(n), n);
	const doc = fs.readFileSync(path.join(repoRoot, "skills/run-evals/SKILL.md"), "utf8");
	for (const n of dirs) assert.ok(doc.includes(`\`${n}\``), `${n} is in the run-evals table`);
});
