import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main as guard } from "../scripts/guard.mjs";
import { git, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const SHARED = {
	rules: [
		{ id: "no-console-log", type: "pattern", files: ["src/**"], pattern: "console\\.log", message: "use the logger", fix: "import { log } from src/log.js" },
		{ id: "no-todo", type: "pattern", files: ["src/**"], pattern: "TODO", message: "todo", fix: "open an issue" },
	],
};

// a monorepo with one shared rules file at the top and two projects that extend it
function monorepo() {
	const top = tempDir("stack-agent-extends-");
	git(top, "init", "-q");
	write(top, "stack-agent-rules.json", JSON.stringify(SHARED));
	for (const p of ["api", "web"]) {
		write(top, `${p}/.stack-agent/guard.config.json`, JSON.stringify({ extends: ["../../stack-agent-rules.json"], rules: [{ id: `${p}-only`, type: "pattern", files: ["src/**"], pattern: "FIXME", message: "fixme", fix: "fix it" }] }));
		write(top, `${p}/src/a.js`, "export const a = 1;\n");
	}
	return top;
}
const project = (top, p = "api") => path.join(top, p);

test("every project that extends the shared file is held to its rules, plus its own", () => {
	const top = monorepo();
	for (const p of ["api", "web"]) {
		write(top, `${p}/src/a.js`, "console.log(1); // FIXME\n");
		const r = guard(["--root", project(top, p), "--strict"]);
		assert.equal(r.code, 1, r.text);
		assert.match(r.text, /\[no-console-log\] use the logger\n {4}found: console\.log\n {4}fix: {3}import \{ log \} from src\/log\.js/);
		assert.match(r.text, new RegExp(`\\[${p}-only\\]`));
	}
});

test("a project cannot redefine a shared rule", () => {
	const top = monorepo();
	write(top, "api/.stack-agent/guard.config.json", JSON.stringify({ extends: ["../../stack-agent-rules.json"], rules: [{ ...SHARED.rules[0], files: ["nothing/**"] }] }));
	assert.throws(() => guard(["--root", project(top)]), /already defined in a shared file \(extends\); a project cannot redefine a shared rule/);
});

test("extends must name existing JSON files inside the repository, with no cycles", () => {
	const top = monorepo();
	const config = (extendsList) => write(top, "api/.stack-agent/guard.config.json", JSON.stringify({ extends: extendsList, rules: [] }));
	config(["../../missing.json"]);
	assert.throws(() => guard(["--root", project(top)]), /file not found/);
	config(["../../../outside.json"]);
	assert.throws(() => guard(["--root", project(top)]), /must be inside the repository/);
	write(top, "a.json", JSON.stringify({ extends: ["b.json"], rules: [] }));
	write(top, "b.json", JSON.stringify({ extends: ["a.json"], rules: [] }));
	config(["../../a.json"]);
	assert.throws(() => guard(["--root", project(top)]), /extends itself/);
	write(top, "bad.json", "{not json");
	config(["../../bad.json"]);
	assert.throws(() => guard(["--root", project(top)]), /is not valid JSON/);
	config("../../stack-agent-rules.json");
	assert.throws(() => guard(["--root", project(top)]), /must be an array of strings/);
});

test("shared files can extend other shared files", () => {
	const top = monorepo();
	write(top, "base.json", JSON.stringify({ rules: [{ id: "no-debugger", type: "pattern", files: ["src/**"], pattern: "debugger", message: "m", fix: "remove it" }] }));
	write(top, "stack-agent-rules.json", JSON.stringify({ ...SHARED, extends: ["base.json"] }));
	write(top, "api/src/a.js", "debugger;\n");
	assert.match(guard(["--root", project(top), "--strict"]).text, /\[no-debugger\]/);
});

test("--compare-ref fails when a shared file drops or narrows a rule, even though the project's config did not change", () => {
	const top = monorepo();
	assert.equal(guard(["--root", project(top), "--update-baseline"]).code, 0);
	git(top, "add", "-A");
	git(top, "commit", "-qm", "base");
	write(top, "stack-agent-rules.json", JSON.stringify({ rules: [{ ...SHARED.rules[0], files: ["src/legacy/**"] }] }));
	const r = guard(["--root", project(top), "--compare-ref", "HEAD"]);
	assert.equal(r.code, 1, r.text);
	assert.match(r.text, /rule changed scope: no-console-log/);
	assert.match(r.text, /rule removed: no-todo/);
});

test("the hooks ask before a shared rules file is edited or written from the shell, and reading it stays free", () => {
	const top = monorepo();
	const api = project(top);
	const hook = (name, input) => {
		const r = runNode(path.join(repoRoot, "scripts/hooks", name), [], { input: JSON.stringify({ cwd: api, session_id: "x", ...input }) });
		return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : undefined;
	};
	write(api, ".stack-agent/verify.json", JSON.stringify({ test: { command: "node -e 0" } }));
	assert.equal(hook("pre-edit-protect.mjs", { tool_name: "Edit", tool_input: { file_path: path.join(top, "stack-agent-rules.json") } }), "ask");
	assert.equal(hook("pre-bash.mjs", { tool_name: "Bash", tool_input: { command: "sed -i s/TODO/X/ ../stack-agent-rules.json" } }), "ask");
	assert.equal(hook("pre-bash.mjs", { tool_name: "Bash", tool_input: { command: `node -e "require('fs').writeFileSync('../stack-agent-rules.json','{}')"` } }), "ask");
	assert.equal(hook("pre-bash.mjs", { tool_name: "Bash", tool_input: { command: "cat ../stack-agent-rules.json" } }), undefined);
	assert.equal(hook("pre-edit-protect.mjs", { tool_name: "Edit", tool_input: { file_path: path.join(api, "src/a.js") } }), undefined);
});

test("init --check counts rules from a shared file as the project's own", () => {
	const top = monorepo();
	const universal = JSON.parse(fs.readFileSync(path.join(repoRoot, "templates/presets/generic/guard.config.json"), "utf8")).rules.filter((r) => ["no-merge-conflict-markers", "no-private-keys", "no-debug-tags"].includes(r.id));
	write(top, "stack-agent-rules.json", JSON.stringify({ rules: [...SHARED.rules, ...universal] }));
	runNode(path.join(repoRoot, "scripts/init.mjs"), [project(top)]);
	assert.doesNotMatch(runNode(path.join(repoRoot, "scripts/init.mjs"), [project(top), "--check"]).stdout, /is in every preset but not in/);
});
