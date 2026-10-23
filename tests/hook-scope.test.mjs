import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { copySample, git, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const preBash = (cwd, command) => {
	const r = runNode(path.join(repoRoot, "scripts/hooks/pre-bash.mjs"), [], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }) });
	assert.equal(r.code, 0, r.stderr);
	return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : undefined;
};

const GIT_RULES = [
	["git commit --no-verify -m x", "deny"],
	["HUSKY=0 git commit -m x", "deny"],
	["git push --force", "ask"],
	["git reset --hard HEAD~1", "ask"],
	["git branch -D old", "ask"],
	['bash -c "git commit -n -m x"', "deny"],
	["rm -rf .github/workflows", "ask"],
];

function plainRepo() {
	const dir = tempDir("stack-agent-plain-");
	git(dir, "init", "-q");
	return dir;
}

test("outside a Stack Agent project the git rules stay out of the way", () => {
	const dir = plainRepo();
	for (const [command] of GIT_RULES) assert.equal(preBash(dir, command), undefined, command);
});

test("inside a Stack Agent project the git rules apply, also from a subfolder", () => {
	const dir = copySample();
	for (const [command, decision] of GIT_RULES) {
		assert.equal(preBash(dir, command), decision, command);
		assert.equal(preBash(path.join(dir, "src", "modules"), command), decision, `${command} (from a subfolder)`);
	}
});

test("a project with only a guard config counts as a Stack Agent project", () => {
	const dir = plainRepo();
	write(dir, ".stack-agent/guard.config.json", "{}");
	assert.equal(preBash(dir, "git commit --no-verify -m x"), "deny");
});

test("the rules about Stack Agent's own files apply everywhere", () => {
	const dir = plainRepo();
	assert.equal(preBash(dir, "rm .stack-agent/guard-baseline.json"), "ask");
	assert.equal(preBash(dir, `node -e "fs.writeFileSync('.stack-agent/evidence/latest.json','{}')"`), "ask");
	assert.equal(preBash(dir, "node .stack-agent/bin/guard.mjs --update-baseline --allow-increase"), "ask");
	assert.equal(preBash(dir, "rm .stack-agent/evidence/sessions/x.json"), "ask");
});
