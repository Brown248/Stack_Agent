import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { withBranch } from "../scripts/init.mjs";
import { git, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const initScript = path.join(repoRoot, "scripts", "init.mjs");
const template = () => fs.readFileSync(path.join(repoRoot, "templates/ci/stack-agent.yml"), "utf8");

// a clone of a repository whose default branch is `branch`, so origin/HEAD points at it as in a real clone
function cloneWithDefault(branch) {
	const src = tempDir("stack-agent-origin-");
	git(src, "init", "-q", "-b", branch);
	write(src, "services/api/README", "x\n");
	git(src, "add", "-A");
	git(src, "commit", "-qm", "first");
	const dst = tempDir("stack-agent-clone-");
	git(dst, "clone", "-q", src, ".");
	return dst;
}

test("init writes the repository's default branch into the workflow's push trigger", () => {
	const dir = cloneWithDefault("master");
	assert.equal(runNode(initScript, [dir]).code, 0);
	const wf = fs.readFileSync(path.join(dir, ".github/workflows/stack-agent.yml"), "utf8");
	assert.match(wf, /^ {4}branches: \["master"\]$/m);
	assert.doesNotMatch(wf, /branches: \[main\]/);
	assert.doesNotMatch(runNode(initScript, [dir, "--check"]).stdout, /runs on pushes to/);
});

test("a repository whose default branch is main gets the template unchanged", () => {
	const dir = cloneWithDefault("main");
	runNode(initScript, [dir]);
	assert.equal(fs.readFileSync(path.join(dir, ".github/workflows/stack-agent.yml"), "utf8"), template());
});

test("without origin/HEAD init keeps main, and --check notes that the default branch is not known", () => {
	const dir = tempDir();
	git(dir, "init", "-q");
	runNode(initScript, [dir]);
	assert.match(fs.readFileSync(path.join(dir, ".github/workflows/stack-agent.yml"), "utf8"), /^ {4}branches: \[main\]$/m);
	const check = runNode(initScript, [dir, "--check"]);
	assert.match(check.stdout, /notes \(do not affect the exit code\):[\s\S]*stack-agent\.yml runs on pushes to main; the default branch is not known yet/);
});

test("--check notes a workflow that does not run on pushes to the default branch", () => {
	const dir = cloneWithDefault("develop");
	write(dir, ".github/workflows/stack-agent.yml", template());
	runNode(initScript, [dir]);
	assert.match(runNode(initScript, [dir, "--check"]).stdout, /runs on pushes to main, but the repository's default branch is develop/);
});

test("a monorepo subfolder workflow gets the default branch too", () => {
	const dir = cloneWithDefault("trunk");
	assert.equal(runNode(initScript, [path.join(dir, "services/api")]).code, 0);
	const wf = fs.readFileSync(path.join(dir, ".github/workflows/stack-agent-services-api.yml"), "utf8");
	assert.match(wf, /^ {4}branches: \["trunk"\]\n {4}paths: \["services\/api\/\*\*"/m);
});

test("withBranch refuses a template without a push branches line", () => {
	assert.throws(() => withBranch("on: push\n", "master"), /no longer has a push branches line/);
	assert.equal(withBranch("anything", "main"), "anything");
});
