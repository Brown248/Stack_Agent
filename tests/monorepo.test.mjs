import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main as guard } from "../scripts/guard.mjs";
import { classify } from "../scripts/hooks/pre-bash.mjs";
import { protectedWhat } from "../scripts/hooks/protected-paths.mjs";
import { subfolderWorkflow } from "../scripts/init.mjs";
import { git, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const initScript = path.join(repoRoot, "scripts", "init.mjs");
const template = () => fs.readFileSync(path.join(repoRoot, "templates/ci/stack-agent.yml"), "utf8");

function monorepo() {
	const top = tempDir("stack-agent-mono-");
	git(top, "init", "-q");
	write(top, "services/api/package.json", "{}\n");
	return { top, project: path.join(top, "services", "api") };
}

test("init in a subfolder of a repository writes the workflow at the top, where GitHub reads it", () => {
	const { top, project } = monorepo();
	const r = runNode(initScript, [project]);
	assert.equal(r.code, 0, r.stderr);
	assert.match(r.stdout, /created {2}\.\.\/\.\.\/\.github\/workflows\/stack-agent-services-api\.yml \(at the top of the repository, running in services\/api\)/);
	assert.ok(!fs.existsSync(path.join(project, ".github")), "no workflow inside the subfolder");
	const wf = fs.readFileSync(path.join(top, ".github/workflows/stack-agent-services-api.yml"), "utf8");
	assert.match(wf, /^name: "stack-agent \(services\/api\)"$/m);
	assert.match(wf, /^defaults:\n {2}run:\n {4}working-directory: "services\/api"\n\njobs:$/m);
	assert.equal((wf.match(/^ {4}paths: \["services\/api\/\*\*", "\.github\/workflows\/stack-agent-services-api\.yml"\]$/gm) ?? []).length, 2, "pull_request and push both filter by path");
	assert.match(wf, /hashFiles\('services\/api\/\.stack-agent\/api-map\.json'\)/);
	assert.match(wf, /path: services\/api\/\.stack-agent\/evidence\//);
	// the run commands stay relative to the project: working-directory puts them there
	assert.match(wf, /run: node \.stack-agent\/bin\/guard\.mjs$/m);
});

test("init at the top of a repository, or outside git, writes the template unchanged", () => {
	const { top } = monorepo();
	assert.equal(runNode(initScript, [top]).code, 0);
	assert.equal(fs.readFileSync(path.join(top, ".github/workflows/stack-agent.yml"), "utf8"), template());
	const plain = tempDir("stack-agent-plain-");
	assert.equal(runNode(initScript, [plain]).code, 0);
	assert.equal(fs.readFileSync(path.join(plain, ".github/workflows/stack-agent.yml"), "utf8"), template());
});

test("rerunning init in a subfolder keeps the workflow, and --check reports its EDIT ME step", () => {
	const { top, project } = monorepo();
	runNode(initScript, [project]);
	const file = path.join(top, ".github/workflows/stack-agent-services-api.yml");
	fs.writeFileSync(file, fs.readFileSync(file, "utf8") + "# mine\n");
	assert.match(runNode(initScript, [project]).stdout, /kept {5}\.\.\/\.\.\/\.github\/workflows\/stack-agent-services-api\.yml/);
	assert.match(fs.readFileSync(file, "utf8"), /# mine\n$/);
	const check = runNode(initScript, [project, "--check"]);
	assert.equal(check.code, 1);
	assert.match(check.stdout, /\.\.\/\.\.\/\.github\/workflows\/stack-agent-services-api\.yml: still has EDIT ME placeholders/);
});

test("--check names a workflow left inside the subfolder, which GitHub never runs", () => {
	const { project } = monorepo();
	write(project, ".github/workflows/stack-agent.yml", template());
	runNode(initScript, [project]);
	const check = runNode(initScript, [project, "--check"]);
	assert.match(check.stdout, /\.github\/workflows\/stack-agent\.yml: GitHub never runs it, because this project is in the subfolder services\/api/);
});

test("subfolderWorkflow refuses a template it no longer recognizes", () => {
	assert.throws(() => subfolderWorkflow("name: other\n", "a", "stack-agent-a.yml"), /no longer contains/);
	assert.doesNotThrow(() => subfolderWorkflow(template().replace(/\n/g, "\r\n"), "a", "stack-agent-a.yml"));
});

function guardedSubproject() {
	const { top, project } = monorepo();
	write(project, ".stack-agent/guard.config.json", JSON.stringify({ rules: [
		{ id: "no-todo", type: "pattern", files: ["src/**"], pattern: "TODO", message: "todo", fix: "do it" },
		{ id: "no-fixme", type: "pattern", files: ["src/**"], pattern: "FIXME", message: "fixme", fix: "fix it" },
	] }));
	write(project, "src/a.js", "// TODO one\n");
	assert.equal(guard(["--root", project, "--update-baseline"]).code, 0);
	git(top, "add", "-A");
	git(top, "commit", "-qm", "base");
	return project;
}

test("--compare-ref in a subfolder project fails when a rule is removed", () => {
	const project = guardedSubproject();
	const file = path.join(project, ".stack-agent/guard.config.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.rules = config.rules.filter((r) => r.id !== "no-fixme");
	fs.writeFileSync(file, JSON.stringify(config));
	const r = guard(["--root", project, "--compare-ref", "HEAD"]);
	assert.equal(r.code, 1, r.text);
	assert.match(r.text, /rule removed: no-fixme/);
});

test("--compare-ref in a subfolder project fails when the baseline grew", () => {
	const project = guardedSubproject();
	write(project, "src/a.js", "// TODO one\n// TODO two\n");
	assert.equal(guard(["--root", project, "--update-baseline", "--allow-increase"]).code, 0);
	const r = guard(["--root", project, "--compare-ref", "HEAD"]);
	assert.equal(r.code, 1, r.text);
	assert.match(r.text, /baseline grew: no-todo src\/a\.js 1 -> 2/);
});

test("the hooks protect a subfolder project's workflow at the top of the repository", () => {
	assert.equal(protectedWhat("/r/.github/workflows/stack-agent-services-api.yml"), "the Stack Agent CI workflow");
	assert.equal(protectedWhat("C:\\r\\.github\\workflows\\stack-agent-web.yaml"), "the Stack Agent CI workflow");
	assert.equal(protectedWhat("/r/.github/workflows/ci.yml"), null);
	assert.equal(classify("rm .github/workflows/stack-agent-services-api.yml")?.decision, "ask");
	assert.equal(classify(`node -e "fs.writeFileSync('.github/workflows/stack-agent-api.yml','')"`)?.decision, "ask");
	assert.equal(classify("cat .github/workflows/stack-agent-services-api.yml"), null);
});
