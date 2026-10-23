// A team's guard rules shared across repositories: init vendors the file like the tools, remembers its source,
// refreshes it on every run, and --check reports a copy that differs from the source.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main as guard } from "../scripts/guard.mjs";
import { repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const initScript = path.join(repoRoot, "scripts", "init.mjs");
const init = (...args) => runNode(initScript, args);
const TEAM = { rules: [{ id: "team-no-console", type: "pattern", files: ["src/**"], pattern: "console\\.log", message: "use the team logger", fix: "import { log } from src/log.js" }] };

function setup() {
	const team = tempDir("stack-agent-team-");
	write(team, "stack-agent-rules.json", JSON.stringify(TEAM, null, 2) + "\n");
	const project = tempDir("stack-agent-proj-");
	write(project, "src/a.js", "export const a = 1;\n");
	return { source: path.join(team, "stack-agent-rules.json"), project };
}
const useShared = (project) => {
	const file = path.join(project, ".stack-agent/guard.config.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	fs.writeFileSync(file, JSON.stringify({ ...config, extends: ["shared-rules.json"] }, null, 2));
};

test("--shared-rules copies the team's file and remembers where it came from; --check asks for the extends line", () => {
	const { source, project } = setup();
	const r = init(project, "--shared-rules", source);
	assert.equal(r.code, 0, r.stderr);
	assert.match(r.stdout, /updated +\.stack-agent\/shared-rules\.json \(from .*stack-agent-rules\.json\)/);
	assert.equal(fs.readFileSync(path.join(project, ".stack-agent/shared-rules.json"), "utf8"), fs.readFileSync(source, "utf8"));
	assert.match(init(project, "--check").stdout, /guard\.config\.json does not use \.stack-agent\/shared-rules\.json; add "extends": \["shared-rules\.json"\]/);
	useShared(project);
	assert.doesNotMatch(init(project, "--check").stdout, /shared-rules/);
});

test("the guard enforces the vendored team rules", () => {
	const { source, project } = setup();
	init(project, "--shared-rules", source);
	useShared(project);
	write(project, "src/a.js", "console.log(1);\n");
	const r = guard(["--root", project, "--strict"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /\[team-no-console\] use the team logger/);
});

test("a changed source is reported, and the next init refreshes the copy", () => {
	const { source, project } = setup();
	init(project, "--shared-rules", source);
	useShared(project);
	fs.writeFileSync(source, JSON.stringify({ rules: [...TEAM.rules, { ...TEAM.rules[0], id: "team-no-debugger", pattern: "debugger" }] }, null, 2) + "\n");
	const check = init(project, "--check");
	assert.equal(check.code, 1);
	assert.match(check.stdout, /outdated: \.stack-agent\/shared-rules\.json differs from .*; rerun init to refresh it/);
	assert.match(init(project).stdout, /updated +\.stack-agent\/shared-rules\.json/);
	assert.match(fs.readFileSync(path.join(project, ".stack-agent/shared-rules.json"), "utf8"), /team-no-debugger/);
	assert.doesNotMatch(init(project, "--check").stdout, /outdated: \.stack-agent\/shared-rules/);
});

test("a source this machine cannot read is a note, not unfinished setup", () => {
	const { source, project } = setup();
	init(project, "--shared-rules", source);
	useShared(project);
	fs.rmSync(source);
	assert.equal(init(project).code, 0, "rerunning init keeps the copy it has");
	const check = init(project, "--check");
	assert.doesNotMatch(check.stdout, /outdated: \.stack-agent\/shared-rules/);
	assert.match(check.stdout, /notes \(do not affect the exit code\):[\s\S]*shared-rules\.json comes from .*, which this machine cannot read/);
});

test("a source that is not a self-contained rules file is refused", () => {
	const { project } = setup();
	const dir = tempDir("stack-agent-team-bad-");
	for (const [name, text, why] of [
		["bad.json", "{not json", /is not valid JSON/],
		["empty.json", '{"rules": []}', /needs a non-empty rules array/],
		["chained.json", JSON.stringify({ ...TEAM, extends: ["other.json"] }), /uses extends; vendor one self-contained file/],
	]) {
		write(dir, name, text);
		const r = init(project, "--shared-rules", path.join(dir, name));
		assert.equal(r.code, 2, name);
		assert.match(r.stderr, why);
	}
	assert.match(init(project, "--shared-rules", path.join(dir, "missing.json")).stderr, /cannot read/);
});
