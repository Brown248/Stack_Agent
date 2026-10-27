// Small behaviors across init, the hooks, the shared libraries, and the A/B harness that had no test of their own.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { collect, format } from "../scripts/ab/inspect.mjs";
import { claudeVersion, resolveClaude } from "../scripts/ab/lib.mjs";
import { parseOptions } from "../scripts/ab/run.mjs";
import { ConfigError, globToRegExp, parseArgs } from "../scripts/lib/files.mjs";
import { codeFingerprint } from "../scripts/lib/fingerprint.mjs";
import { copySample, git, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const hook = (name) => path.join(repoRoot, "scripts", "hooks", name);
const initScript = path.join(repoRoot, "scripts", "init.mjs");

test("init --list-presets prints one preset per line", () => {
	const r = runNode(initScript, ["--list-presets"]);
	assert.equal(r.code, 0, r.stderr);
	assert.deepEqual(r.stdout.trim().split(/\r?\n/), ["backend-http", "cli", "frontend-web", "generic", "library"]);
});

test("init --check lists a missing API map and a missing guard baseline as unfinished setup", () => {
	const dir = copySample();
	assert.equal(runNode(initScript, [dir]).code, 0);
	fs.rmSync(path.join(dir, ".stack-agent/api-map.md"));
	fs.rmSync(path.join(dir, ".stack-agent/guard-baseline.json"));
	const r = runNode(initScript, [dir, "--check"]);
	assert.equal(r.code, 1);
	assert.match(r.stdout + r.stderr, /\.stack-agent\/api-map\.md: missing, create it with `node \.stack-agent\/bin\/api-map\.mjs --draft`/);
	assert.match(r.stdout + r.stderr, /\.stack-agent\/guard-baseline\.json: missing, record existing violations with/);
});

test("the guard hooks report a broken guard config instead of crashing", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ rules: [{ id: "Bad Id", type: "pattern", files: ["**"], pattern: "x", message: "m", fix: "f" }] }));
	write(dir, "src/x.js", "x\n");
	const edit = runNode(hook("post-edit-guard.mjs"), [], { input: JSON.stringify({ tool_name: "Write", cwd: dir, tool_input: { file_path: "src/x.js" } }) });
	assert.equal(edit.code, 1);
	assert.match(edit.stderr, /stack-agent guard: config error: rule "Bad Id": id must be kebab-case/);
	const bash = runNode(hook("post-bash-guard.mjs"), [], { input: JSON.stringify({ tool_name: "Bash", cwd: dir, session_id: "cfg", tool_input: { command: "touch src/x.js" } }) });
	assert.equal(bash.code, 1);
	assert.match(bash.stderr, /stack-agent guard: config error in \.stack-agent\/guard\.config\.json: rule "Bad Id"/);
});

test("the after-shell guard leaves onEdit: skip rules to the guard, and leaves a huge change to the Stop hook", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	const input = (id) => JSON.stringify({ tool_name: "Bash", cwd: dir, session_id: id, tool_input: { command: "x" } });
	write(dir, "src/modules/items/service.js", fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8") + "// [DEBUG-ab12] still here\n");
	assert.equal(runNode(hook("post-bash-guard.mjs"), [], { input: input("skip") }).code, 0, "no-debug-tags is onEdit: skip");
	write(dir, "src/modules/items/controller.js", 'export const q = "SELECT * FROM items";\n');
	for (let i = 0; i < 2001; i++) fs.writeFileSync(path.join(dir, "src", `gen-${i}.js`), "\n");
	assert.equal(runNode(hook("post-bash-guard.mjs"), [], { input: input("huge") }).code, 0, "over 2,000 changed files: no check here");
});

test("the code fingerprint gives up (null) above 5,000 changed files rather than outlast a hook's time limit", () => {
	const dir = tempDir("stack-agent-fp-");
	write(dir, "a.js", "a\n");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	assert.ok(codeFingerprint(dir));
	fs.mkdirSync(path.join(dir, "gen"));
	for (let i = 0; i < 5001; i++) fs.writeFileSync(path.join(dir, "gen", `f${i}.js`), "\n");
	assert.equal(codeFingerprint(dir), null);
});

test("globs: ? matches exactly one character other than a slash", () => {
	const re = globToRegExp("src/v?.js");
	assert.ok(re.test("src/v1.js"));
	assert.ok(!re.test("src/v10.js"));
	assert.ok(!re.test("src/v/.js"));
});

test("parseArgs names an option with no value and an unknown option", () => {
	assert.throws(() => parseArgs(["--root"], { options: ["root"] }), (e) => e instanceof ConfigError && e.message === "--root needs a value");
	assert.throws(() => parseArgs(["--nope"], {}), (e) => e instanceof ConfigError && e.message === "unknown option --nope");
});

test("A/B: inspect reads a folder or files and formats a summary; the harness checks claude and --plugin", () => {
	const dir = tempDir("stack-agent-abx-");
	write(dir, "runs/b.jsonl", "");
	write(dir, "runs/a.jsonl", "");
	write(dir, "runs/notes.txt", "");
	assert.deepEqual(collect([path.join(dir, "runs")]).map((f) => path.basename(f)), ["a.jsonl", "b.jsonl"]);
	assert.throws(() => collect([path.join(dir, "missing")]), (e) => e instanceof ConfigError && /does not exist/.test(e.message));
	const text = format("x/run.jsonl", { skills: ["stack-agent:debug"], feedback: [{ position: "before", firstLine: "stack-agent: no evidence" }], verifyRuns: [], edited: ["src/a.js"], usage: { cost: 0.12, turns: 9 } });
	assert.match(text, /== run\.jsonl\n {2}skills: stack-agent:debug\n {2}stop-hook feedback: 1\n {4}before: stack-agent: no evidence\n {2}verify runs: none\n {2}edited: src\/a\.js\n {2}cost: \$0\.12 in 9 turns/);

	if (process.platform === "win32") {
		const bin = tempDir("stack-agent-abx-");
		fs.writeFileSync(path.join(bin, "claude.exe"), "");
		assert.equal(resolveClaude({ PATH: bin }).command, path.join(bin, "claude.exe"));
		assert.throws(() => resolveClaude({ PATH: tempDir("stack-agent-abx-") }), /claude\.exe not found on PATH/);
	}
	// a script, not -e: node reads a --version after -e as its own flag
	write(dir, "broken-claude.cjs", 'console.error("not signed in"); process.exit(3);\n');
	assert.throws(() => claudeVersion({ command: process.execPath, prefix: [path.join(dir, "broken-claude.cjs")] }), (e) => e instanceof ConfigError && /claude --version failed: not signed in/.test(e.message));
	assert.throws(() => parseOptions(["--task", "endpoint", "--model", "m", "--budget", "1", "--plugin", tempDir("stack-agent-abx-")]), (e) => e instanceof ConfigError && /has no \.claude-plugin\/plugin\.json/.test(e.message));
});

test("review-findings refuses a findings file over 5 MB; sample-commits says when nothing matched", async () => {
	const { main: findings } = await import("../scripts/review-findings.mjs");
	const { main: sample } = await import("../scripts/sample-commits.mjs");
	const dir = tempDir("stack-agent-small-");
	const big = path.join(dir, "findings.json");
	fs.writeFileSync(big, "[" + " ".repeat(5 * 1024 * 1024) + "]");
	assert.throws(() => findings(["validate", big]), (e) => e instanceof ConfigError && /findings\.json is over 5 MB/.test(e.message));
	write(dir, "a.js", "a\n");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	const r = sample(["--root", dir, "--since", "2099-01-01", "--no-ledger"]);
	assert.match(r.text, /no commits matched; widen --since or pass --range/);
});

test("an installed example's npm scripts run the vendored tools, not files from the Stack Agent repo", async () => {
	const { scaffold } = await import("../evals/scaffold.mjs");
	const dir = tempDir("stack-agent-npm-");
	scaffold(dir, repoRoot, "sample-backend");
	const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
	for (const [name, script] of Object.entries(pkg.scripts)) assert.doesNotMatch(script, /\.\.\//, `${name} reaches outside the project: ${script}`);
	const r = runNode(path.join(dir, ".stack-agent/bin/guard.mjs"), [], { cwd: dir });
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.match(pkg.scripts.guard, /\.stack-agent\/bin\/guard\.mjs/);
});

test("a project reached through a Windows 8.3 short name is the same project git reports by its long name", async (t) => {
	if (process.platform !== "win32") return t.skip("8.3 short names are a Windows thing");
	const { spawnSync } = await import("node:child_process");
	const { realPath } = await import("../scripts/lib/files.mjs");
	const { main: guard } = await import("../scripts/guard.mjs");
	const long = path.join(tempDir("stack-agent-83-"), "a-folder-name-longer-than-eight");
	fs.mkdirSync(long);
	const short = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${long}').ShortPath`], { encoding: "utf8" }).stdout.trim();
	if (!short || short.toLowerCase() === long.toLowerCase()) return t.skip("this volume does not make 8.3 short names");
	assert.equal(realPath(short), realPath(long));
	assert.equal(realPath(path.join(short, "not-yet", "file.json")), path.join(realPath(long), "not-yet", "file.json"), "a path that does not exist yet");
	// what GitHub's Windows runner hit: a shared rules file inside the repository looked like it was outside
	write(long, "shared/rules.json", JSON.stringify({ rules: [{ id: "no-todo", type: "pattern", files: ["**/*.js"], pattern: "TODO", message: "m", fix: "f" }] }));
	write(long, "app/.stack-agent/guard.config.json", JSON.stringify({ extends: ["../../shared/rules.json"], rules: [{ id: "no-fixme", type: "pattern", files: ["**/*.js"], pattern: "FIXME", message: "m", fix: "f" }] }));
	write(long, "app/src/a.js", "// TODO later\n");
	git(long, "init", "-q");
	const r = guard(["--root", path.join(short, "app")]);
	assert.equal(r.code, 1, r.text);
	assert.match(r.text, /src\/a\.js:1 {2}\[no-todo\]/, "the shared rule applies");
});
