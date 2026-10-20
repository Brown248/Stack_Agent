import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { scaffold } from "../evals/scaffold.mjs";
import { ARMS, checkIsolation, claudeArgs, makeArmPlugin, parseTranscript, resolveClaude, spawnClaude, summarizeTranscript } from "../scripts/ab/lib.mjs";
import { parseOptions, summarize } from "../scripts/ab/run.mjs";
import * as endpoint from "../scripts/ab/tasks/endpoint.mjs";
import * as validate from "../scripts/ab/tasks/validate.mjs";
import { freePort, repoRoot, runNode, tempDir, usePort, write } from "./helpers.mjs";

const runScript = path.join(repoRoot, "scripts", "ab", "run.mjs");

function project() {
	const dir = tempDir("stack-agent-ab-");
	scaffold(dir, repoRoot);
	return dir;
}

async function verifyOnFreePort(dir) {
	usePort(dir, await freePort());
	const r = runNode(path.join(dir, ".stack-agent/bin/verify.mjs"), [], { cwd: dir });
	assert.equal(r.code, 0, r.stdout + r.stderr);
}

function solveEndpoint(dir) {
	write(dir, "src/app.js", `import http from "node:http";
import { routes } from "./routes.js";

function matchPath(pattern, pathname) {
	const want = pattern.split("/");
	const got = pathname.split("/");
	if (want.length !== got.length) return null;
	const params = {};
	for (let i = 0; i < want.length; i++) {
		if (want[i].startsWith(":")) params[want[i].slice(1)] = decodeURIComponent(got[i]);
		else if (want[i] !== got[i]) return null;
	}
	return params;
}

export function createApp() {
	return http.createServer(async (req, res) => {
		res.json = (status, body) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		const url = new URL(req.url, "http://localhost");
		let params;
		const match = routes.find((r) => r.method === req.method && (params = matchPath(r.path, url.pathname)));
		if (!match) return res.json(404, { error: "not found" });
		req.params = params;
		try {
			req.body = await readBody(req);
		} catch {
			return res.json(400, { error: "invalid JSON body" });
		}
		match.handler(req, res);
	});
}

async function readBody(req) {
	let raw = "";
	for await (const chunk of req) raw += chunk;
	return raw ? JSON.parse(raw) : undefined;
}
`);
	const routes = fs.readFileSync(path.join(dir, "src/routes.js"), "utf8").replace('\troute("GET", "/reports/summary"', '\troute("DELETE", "/items/:id", items.remove),\n\troute("GET", "/reports/summary"');
	write(dir, "src/routes.js", routes);
	write(dir, "src/modules/items/repository.js", `import { db } from "../../db.js";

export function insertItem(name) {
	return db().prepare("INSERT INTO items (name) VALUES (?) RETURNING id, name").get(name);
}

export function listItems() {
	return db().prepare("SELECT id, name FROM items ORDER BY id").all();
}

export function deleteItem(id) {
	return db().prepare("DELETE FROM items WHERE id = ?").run(id).changes > 0;
}
`);
	write(dir, "src/modules/items/service.js", fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8").replace('import { insertItem, listItems }', 'import { deleteItem, insertItem, listItems }') + "\nexport function removeItem(id) {\n\treturn deleteItem(id);\n}\n");
	write(dir, "src/modules/items/controller.js", fs.readFileSync(path.join(dir, "src/modules/items/controller.js"), "utf8").replace('import { createItem, getItems }', 'import { createItem, getItems, removeItem }') + `
export function remove(req, res) {
	if (!removeItem(Number(req.params.id))) return res.json(404, { error: "item not found" });
	res.writeHead(204);
	res.end();
}
`);
	write(dir, "test/items.test.js", fs.readFileSync(path.join(dir, "test/items.test.js"), "utf8") + `
test("DELETE /items/:id removes an item, then 404s", async () => {
	const created = await (await fetch(\`\${base}/items\`, { method: "POST", body: JSON.stringify({ name: "pen" }) })).json();
	assert.equal((await fetch(\`\${base}/items/\${created.id}\`, { method: "DELETE" })).status, 204);
	assert.equal((await fetch(\`\${base}/items/\${created.id}\`, { method: "DELETE" })).status, 404);
});
`);
	const map = fs.readFileSync(path.join(dir, ".stack-agent/api-map.md"), "utf8");
	write(dir, ".stack-agent/api-map.md", map.replace("| GET | /reports/summary", "| DELETE | /items/:id | src/modules/items/controller.js | items/service.removeItem → items/repository.deleteItem → table items | items |\n| GET | /reports/summary"));
}

function solveValidate(dir, limit = "> 50") {
	const svc = path.join(dir, "src/modules/items/service.js");
	write(dir, "src/modules/items/service.js", fs.readFileSync(svc, "utf8").replace('\treturn { item: insertItem(name) };', `\tif (name.length ${limit}) return { error: "name must be at most 50 characters" };\n\treturn { item: insertItem(name) };`));
	write(dir, "test/items.test.js", fs.readFileSync(path.join(dir, "test/items.test.js"), "utf8") + `
test("POST /items rejects a name longer than 50 characters", async () => {
	const res = await fetch(\`\${base}/items\`, { method: "POST", body: JSON.stringify({ name: "x".repeat(51) }) });
	assert.equal(res.status, 400);
});
`);
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.checks.push({ name: "create-item-rejects-long-name", method: "POST", path: "/items", body: { name: "x".repeat(51) }, expectStatus: 400 });
	fs.writeFileSync(file, JSON.stringify(config, null, 2));
}

const failing = (grade) => Object.entries(grade.checks).filter(([, v]) => v !== true).map(([k]) => k);

test("graders: an untouched sample copy fails the behavior check for both tasks", async () => {
	for (const task of [endpoint, validate]) {
		const g = await task.grade(project());
		assert.equal(g.checks.behavior, false, `${task.name}: ${g.details.behavior}`);
		assert.equal(g.checks.testsPass, true);
		assert.equal(g.checks.selfVerified, false, "no evidence yet");
		assert.equal(g.checks.testAdded, false);
	}
});

test("graders: a hand-implemented endpoint passes, and a broken one fails", async () => {
	const dir = project();
	solveEndpoint(dir);
	await verifyOnFreePort(dir);
	let g = await endpoint.grade(dir);
	assert.deepEqual(failing(g), [], JSON.stringify(g.details));

	write(dir, "src/modules/items/repository.js", fs.readFileSync(path.join(dir, "src/modules/items/repository.js"), "utf8").replace("run(id).changes > 0", "run(id) && true"));
	g = await endpoint.grade(dir);
	assert.equal(g.checks.behavior, false, "deleting twice must 404");
});

test("graders: a hand-implemented validation passes, and an off-by-one one fails", async () => {
	const dir = project();
	solveValidate(dir);
	await verifyOnFreePort(dir);
	let g = await validate.grade(dir);
	assert.deepEqual(failing(g), [], JSON.stringify(g.details));
	assert.match(g.details.newChecks, /create-item-rejects-long-name/);

	write(dir, "src/modules/items/service.js", fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8").replace("> 50", ">= 50"));
	g = await validate.grade(dir);
	assert.equal(g.checks.behavior, false, "a 50 character name must still be accepted");
});

test("graders: a verify check that never ran does not count as evidence", async () => {
	const dir = project();
	solveValidate(dir);
	const g = await validate.grade(dir);
	assert.equal(g.checks.checkAdded, true);
	assert.equal(g.checks.evidenceCoversRule, false);
	assert.equal(g.checks.selfVerified, false);
});

test("--dry-run scaffolds and grades an untouched copy without calling claude", () => {
	const out = path.join(tempDir(), "out");
	const r = spawnSync(process.execPath, [runScript, "--task", "endpoint", "--arms", "full,hooks-only", "--model", "sonnet", "--budget", "1", "--dry-run", "--json", "--out", out], { encoding: "utf8", env: { ...process.env, CLAUDE_BIN: path.join(out, "does-not-exist.exe") } });
	assert.equal(r.status, 0, r.stderr);
	const printed = JSON.parse(r.stdout);
	assert.deepEqual(printed.runs.map((x) => [x.arm, x.status]), [["full", "dry-run"], ["hooks-only", "dry-run"]]);
	assert.equal(printed.runs[0].grade.behavior, false);
	const saved = JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"));
	assert.equal(saved.runs.length, 2);
	assert.equal(saved.meta.dryRun, true);
	assert.ok(fs.existsSync(path.join(out, "plugins", "hooks-only")));
});

test("--model and --budget are required, and bad values are usage errors", () => {
	const base = ["--task", "endpoint", "--dry-run"];
	let r = runNode(runScript, [...base, "--model", "sonnet"]);
	assert.equal(r.code, 2);
	assert.match(r.stderr, /--budget is required/);
	r = runNode(runScript, [...base, "--budget", "1"]);
	assert.equal(r.code, 2);
	assert.match(r.stderr, /--model is required/);
	r = runNode(runScript, ["--model", "m", "--budget", "1"]);
	assert.match(r.stderr, /--task is required/);
	assert.throws(() => parseOptions([...base, "--model", "m", "--budget", "0"]), /positive number/);
	assert.throws(() => parseOptions([...base, "--model", "m", "--budget", "1", "--arms", "full,bogus"]), /unknown arm "bogus"/);
	assert.throws(() => parseOptions(["--task", "nope", "--model", "m", "--budget", "1", "--out", path.join(repoRoot, "x")]), /inside the plugin/);
	const ok = parseOptions([...base, "--task", "validate", "--model", "m", "--budget", "1", "--out", tempDir()]);
	assert.deepEqual(ok.tasks, ["endpoint", "validate"]);
	assert.deepEqual(ok.arms, ["full", "none"]);
	assert.equal(ok.isolate, true);
});

test("an unknown task names the available ones", () => {
	const r = runNode(runScript, ["--task", "nope", "--model", "m", "--budget", "1", "--dry-run", "--out", path.join(tempDir(), "o")]);
	assert.equal(r.code, 2);
	assert.match(r.stderr, /unknown task "nope" \(available: endpoint, validate, validate-hurry\)/);
});

test("hooks-only and skills-only plugin copies really lack the removed part", () => {
	const out = tempDir();
	const hooksOnly = makeArmPlugin("hooks-only", repoRoot, out);
	const skillsOnly = makeArmPlugin("skills-only", repoRoot, out);
	assert.equal(makeArmPlugin("full", repoRoot, out), repoRoot);
	assert.equal(makeArmPlugin("none", repoRoot, out), null);
	assert.equal(fs.existsSync(path.join(hooksOnly, "skills")), false);
	assert.ok(fs.existsSync(path.join(hooksOnly, "hooks", "hooks.json")));
	assert.equal(fs.existsSync(path.join(skillsOnly, "hooks", "hooks.json")), false);
	assert.ok(fs.existsSync(path.join(skillsOnly, "skills")));
	for (const copy of [hooksOnly, skillsOnly]) {
		assert.ok(fs.existsSync(path.join(copy, ".claude-plugin", "plugin.json")));
		assert.ok(fs.existsSync(path.join(copy, "scripts", "hooks", "stop-verify.mjs")));
		for (const excluded of ["examples", "tests", ".git", path.join("evals", "results")]) assert.equal(fs.existsSync(path.join(copy, excluded)), false, excluded);
	}
	assert.ok(fs.existsSync(path.join(repoRoot, "skills")), "the source plugin is untouched");
});

const line = (o) => JSON.stringify(o);
const init = (plugins, skills = []) => line({ type: "system", subtype: "init", cwd: "/p", plugins: plugins.map((name) => ({ name, source: `${name}@inline` })), skills });
const check = (arm, lines, isolate = true) => checkIsolation({ arm, parsed: parseTranscript(lines.join("\n")), isolate });
const SA_SKILLS = ["stack-agent:verify", "stack-agent:add-endpoint"];

test("isolation check: a plugin arm that also loaded another plugin is invalid", () => {
	assert.equal(check("full", [init(["stack-agent"], SA_SKILLS)]).ok, true);
	const bad = check("full", [init(["stack-agent", "fleet"], SA_SKILLS)]);
	assert.equal(bad.ok, false);
	assert.match(bad.reasons.join(), /fleet/);
	assert.equal(check("full", [init(["stack-agent", "fleet"], SA_SKILLS)], false).ok, true, "not isolated: other plugins are expected");
	assert.match(check("full", [init(["fleet"])]).reasons.join(), /did not load/);
});

test("isolation check: builtin plugins are ignored, the none arm must load nothing", () => {
	const builtin = line({ type: "system", subtype: "init", plugins: [{ name: "cc-plugin-telemetry", source: "cc-plugin-telemetry@builtin" }], skills: [] });
	assert.equal(check("none", [builtin]).ok, true);
	assert.equal(check("none", [init([])]).ok, true);
	assert.equal(check("none", [init(["fleet"])]).ok, false);
	assert.equal(check("none", [init(["stack-agent"], SA_SKILLS)]).ok, false);
	assert.equal(check("none", []).ok, false, "no init event");
});

test("isolation check: hooks-only must not expose skills, skills-only must not fire hooks", () => {
	assert.equal(check("hooks-only", [init(["stack-agent"], [])]).ok, true);
	assert.match(check("hooks-only", [init(["stack-agent"], SA_SKILLS)]).reasons.join(), /hooks-only still exposes skills/);
	assert.equal(check("skills-only", [init(["stack-agent"], SA_SKILLS)]).ok, true);
	const feedback = line({ type: "user", message: { role: "user", content: [{ type: "text", text: 'Stop hook feedback:\n[node "/x/scripts/hooks/stop-verify.mjs"]: stack-agent: code changed' }] } });
	assert.match(check("skills-only", [init(["stack-agent"], SA_SKILLS), feedback]).reasons.join(), /skills-only still shows 1 stack-agent hook/);
	const started = line({ type: "system", subtype: "hook_started", hook_name: "Stop", command: 'node "C:\\p\\scripts\\hooks\\post-edit-guard.mjs"' });
	assert.equal(check("skills-only", [init(["stack-agent"], SA_SKILLS), started]).ok, false);
});

test("transcript summary: Stop-hook feedback is placed relative to the first verify.json edit", () => {
	const tool = (name, input) => line({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });
	const feedback = line({ type: "user", message: { content: [{ type: "text", text: "Stop hook feedback:\n[node stop-verify.mjs]: stack-agent: code changed\nsecond line" }] } });
	const text = [
		init(["stack-agent"], SA_SKILLS),
		tool("Skill", { skill: "stack-agent:verify" }),
		tool("Edit", { file_path: "/p/src/a.js" }),
		feedback,
		tool("Edit", { file_path: "/p/.stack-agent/verify.json" }),
		tool("Bash", { command: "node .stack-agent/bin/verify.mjs" }),
		line({ type: "result", total_cost_usd: 0.3, num_turns: 4 }),
	].join("\n");
	const s = summarizeTranscript(text);
	assert.deepEqual(s.skills, ["stack-agent:verify"]);
	assert.deepEqual(s.edited, ["src/a.js", ".stack-agent/verify.json"]);
	assert.equal(s.feedback.length, 1);
	assert.equal(s.feedback[0].position, "before first verify.json edit");
	assert.equal(s.feedback[0].firstLine, "[node stop-verify.mjs]: stack-agent: code changed");
	assert.equal(s.verifyRuns.length, 1);
	assert.equal(s.usage.cost, 0.3);
});

function fakeClaude() {
	const dir = tempDir();
	const file = path.join(dir, "fake-claude.mjs");
	write(dir, "fake-claude.mjs", `const argv = process.argv.slice(2);
if (argv[0] === "--version") {
	console.log("9.9.9 (fake)");
	process.exit(0);
}
if (process.env.FAKE_ECHO) {
	console.log(JSON.stringify(argv));
	process.exit(0);
}
const plugins = argv.includes("--plugin-dir") ? [{ name: "stack-agent", source: "stack-agent@inline" }] : [];
if (process.env.FAKE_EXTRA) plugins.push({ name: "intruder", source: "intruder@inline" });
console.log(JSON.stringify({ type: "system", subtype: "init", cwd: process.cwd(), plugins, skills: [] }));
console.log(JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "Stop hook feedback:\\n[node stop-verify.mjs]: remember to verify" }] } }));
console.log(JSON.stringify({ type: "result", total_cost_usd: 0.25, num_turns: 3, is_error: false, result: "done" }));
`);
	return file;
}

test("the prompt reaches the child as one argument, with no shell in between", () => {
	const bin = fakeClaude();
	const claude = resolveClaude({ CLAUDE_BIN: bin });
	assert.equal(claude.command, process.execPath);
	const prompt = 'Add DELETE /items/:id. It should return 204 & "404" for $HOME; (really) works > out';
	const old = process.env.FAKE_ECHO;
	process.env.FAKE_ECHO = "1";
	try {
		const r = spawnClaude(claude, claudeArgs({ prompt, model: "sonnet", budget: 1, pluginDir: "C:/some dir/plugin", isolate: true }), tempDir());
		const argv = JSON.parse(r.stdout);
		assert.equal(argv[0], "-p");
		assert.equal(argv[1], prompt);
		assert.equal(argv[argv.indexOf("--plugin-dir") + 1], "C:/some dir/plugin");
		assert.deepEqual(argv.slice(argv.indexOf("--setting-sources")), ["--setting-sources", "project,local", "--strict-mcp-config", "--plugin-dir", "C:/some dir/plugin"]);
		assert.equal(argv[argv.indexOf("--max-budget-usd") + 1], "1");
	} finally {
		if (old === undefined) delete process.env.FAKE_ECHO;
		else process.env.FAKE_ECHO = old;
	}
	assert.ok(!claudeArgs({ prompt, model: "m", budget: 1, isolate: false }).includes("--setting-sources"));
	assert.ok(!claudeArgs({ prompt, model: "m", budget: 1, isolate: false }).includes("--plugin-dir"));
});

test("end to end with a fake claude: metadata is recorded and valid runs are summarized", () => {
	const out = path.join(tempDir(), "out");
	const r = spawnSync(process.execPath, [runScript, "--task", "validate", "--arms", "full,none", "--model", "sonnet", "--budget", "0.5", "--json", "--out", out], { encoding: "utf8", env: { ...process.env, CLAUDE_BIN: fakeClaude() } });
	assert.equal(r.status, 0, r.stderr);
	const saved = JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"));
	assert.equal(saved.meta.claudeVersion, "9.9.9 (fake)");
	assert.equal(saved.meta.harnessVersion, JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version);
	assert.ok(["boolean", "object"].includes(typeof saved.meta.pluginDirty));
	assert.ok(typeof saved.meta.pluginSha === "string");
	const [full, none] = saved.runs;
	assert.equal(full.status, "ok");
	assert.equal(full.usage.cost, 0.25);
	assert.equal(full.usage.turns, 3);
	assert.equal(full.hookFeedback.count, 1);
	assert.equal(full.hookFeedback.first, "[node stop-verify.mjs]: remember to verify");
	assert.equal(full.budget, 0.5);
	assert.equal(full.model, "sonnet");
	assert.equal(full.prompt, validate.prompt);
	assert.equal(none.status, "ok");
	assert.ok(fs.existsSync(path.join(out, "runs", "validate-full-1.jsonl")));
	assert.match(summarize(saved.runs), /\$0\.250/);
});

test("end to end with a fake claude: a run that loaded an extra plugin is invalid, reported loudly, and excluded", () => {
	const out = path.join(tempDir(), "out");
	const r = spawnSync(process.execPath, [runScript, "--task", "validate", "--arms", "none", "--model", "sonnet", "--budget", "0.5", "--out", out], { encoding: "utf8", env: { ...process.env, CLAUDE_BIN: fakeClaude(), FAKE_EXTRA: "1" } });
	assert.equal(r.status, 1, r.stdout + r.stderr);
	assert.match(r.stderr, /INVALID RUN validate-none-1: none arm loaded plugins: intruder/);
	assert.match(r.stdout, /INVALID RUNS \(1\)/);
	assert.match(r.stdout, /0\/1 +/, "the invalid run is not counted as valid");
	assert.equal(JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8")).runs[0].status, "invalid");
});

test("the arm list is the documented one", () => {
	assert.deepEqual(ARMS, ["full", "none", "hooks-only", "skills-only"]);
});

test("an isolated run drops plugin variables a parent Claude Code set; a non-isolated run keeps them", async () => {
	const { claudeEnv } = await import("../scripts/ab/lib.mjs");
	const parent = { PATH: "x", CLAUDE_CODE_PLUGIN_DIRS: "C:\mods\a;C:\mods\b" };
	const isolated = claudeEnv(true, parent);
	assert.equal("CLAUDE_CODE_PLUGIN_DIRS" in isolated.env, false);
	assert.deepEqual(isolated.removed, ["CLAUDE_CODE_PLUGIN_DIRS"]);
	assert.equal(isolated.env.PATH, "x");
	assert.equal(claudeEnv(false, parent).env.CLAUDE_CODE_PLUGIN_DIRS, parent.CLAUDE_CODE_PLUGIN_DIRS);
});
