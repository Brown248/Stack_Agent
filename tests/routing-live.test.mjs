// The live routing check, run against a fake claude so no test spends money. The fake answers like a model that loads
// the skill a request names (by a keyword), another tool for some, and nothing for the rest; it records every argv.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ConfigError } from "../scripts/lib/files.mjs";
import { ITEMS, shippedSkills } from "../scripts/micro/cases/skill-routing.mjs";
import { armPlugins, bareName, firstChoice, judge, liveArgs, main, measure, parseOptions, pickItems, readRequests, runSession, summarize } from "../scripts/micro/routing-live.mjs";
import { memoryFilesAbove, pickWorkBase } from "../scripts/micro/work-dir.mjs";
import { repoRoot, tempDir, write } from "./helpers.mjs";

const script = path.join(repoRoot, "scripts", "micro", "routing-live.mjs");
const SKILLS = shippedSkills().filter((s) => !s.hidden).map((s) => `stack-agent:${s.name}`);

// mode: "right" loads the skill each request is written for; "glob" starts every session with a Glob call; "none"
// answers in text; "broken" loads no plugin; "slow" waits past the timeout; "late" prints a tool call after the first
function fakeClaude(mode = "right") {
	const dir = tempDir("stack-agent-live-fake-");
	const plugins = mode === "broken" ? "[]" : '[{ name: "stack-agent", source: "stack-agent@inline" }]';
	write(
		dir,
		"fake-claude.mjs",
		`import fs from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] === "--version") { console.log("9.9.9 (fake)"); process.exit(0); }
fs.appendFileSync(${JSON.stringify(path.join(dir, "calls.jsonl"))}, JSON.stringify({ argv, cwd: process.cwd(), files: fs.readdirSync(process.cwd()) }) + "\\n");
const out = (o) => console.log(JSON.stringify(o));
const request = argv[argv.indexOf("-p") + 1];
const mode = ${JSON.stringify(mode)};
if (mode === "nologin") { out({ type: "result", subtype: "success", is_error: true, result: "Not logged in - Please run /login" }); process.exit(1); }
out({ type: "system", subtype: "init", cwd: process.cwd(), plugins: ${plugins}, skills: mode === "noskills" ? [] : ${JSON.stringify(SKILLS)} });
if (mode === "pause") await new Promise((r) => setTimeout(r, 600));
if (mode === "slow") setTimeout(() => out({ type: "result", is_error: false, result: "late" }), 60000);
else if (mode === "hang") { out({ type: "assistant", message: { content: [{ type: "text", text: "let me think about that" }] } }); setInterval(() => {}, 1000); }
else if (mode === "budget") { out({ type: "assistant", message: { content: [{ type: "text", text: "started" }] } }); out({ type: "result", subtype: "error_max_budget_usd", is_error: false, result: "", total_cost_usd: 0.2 }); }
else {
	const pick = [["returns 201", "debug"], ["totals say", "debug"], ["Prove it works", "verify"], ["run the checks", "verify"], ["DELETE /items", "add-endpoint"], ["health checks", "add-endpoint"], ["notes column", "add-migration"], ["users.email", "add-migration"], ["GET /reports", "api-map"], ["/ping", "api-map"], ["--top", "feature-map"], ["--limit", "feature-map"]].find(([k]) => request.includes(k))?.[1];
	const content = mode === "hidden" ? [{ type: "tool_use", name: "Skill", input: { skill: "stack-agent:correct" } }] : mode === "glob" ? [{ type: "tool_use", name: "Glob", input: { pattern: "**/*" } }]
		: mode === "none" || !pick ? [{ type: "text", text: "Sure, here is an explanation." }]
		: [{ type: "text", text: "I will load a skill." }, { type: "tool_use", name: "Skill", input: { skill: "stack-agent:" + pick } }];
	out({ type: "assistant", message: { content } });
	if (mode === "stays") setInterval(() => fs.writeFileSync(${JSON.stringify(path.join(dir, "beat.txt"))}, String(Date.now())), 50);
	else {
		if (mode === "late") out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "stack-agent:debug" } }] } });
		out({ type: "result", subtype: "success", is_error: false, result: "done", total_cost_usd: 0.004 });
	}
}
`,
	);
	return { bin: path.join(dir, "fake-claude.mjs"), beat: () => (fs.existsSync(path.join(dir, "beat.txt")) ? fs.readFileSync(path.join(dir, "beat.txt"), "utf8") : ""), calls: () => (fs.existsSync(path.join(dir, "calls.jsonl")) ? fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []) };
}

const run = (fake, args) => main(["--model", "m", "--budget", "0.1", "--out", path.join(tempDir("stack-agent-live-out-"), "o"), ...(args.includes("--project") ? [] : ["--project", "bare"]), ...(args.includes("--work-dir") ? [] : ["--work-dir", tempDir("stack-agent-live-work-")]), ...args], { env: { ...process.env, CLAUDE_BIN: fake.bin } });

test("options: model and budget are required, numbers stay in range, arms are checked", () => {
	assert.throws(() => parseOptions(["--budget", "1"]), /--model is required/);
	assert.throws(() => parseOptions(["--model", "m"]), /--budget must be a positive/);
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--runs", "0"]), /--runs must be a whole number from 1 to 20/);
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--concurrency", "9"]), /--concurrency/);
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--arms", "none"]), /--arms must list/);
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--arms", "full,full"]), /--arms must list/);
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--arms", "full+superpowers"]), /needs --superpowers DIR/);
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--total-budget", "0"]), /--total-budget/);
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--project", "mine"]), /--project must be sample or bare/);
	for (const bad of ["0", "35", "1,1", "a", "2,"]) assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--only", bad]), /--only must list distinct request numbers from 1 to 34/, bad);
	assert.deepEqual(parseOptions(["--model", "m", "--budget", "1", "--only", "7, 17,21"]).only, [7, 17, 21]);
	const o = parseOptions(["--model", "m", "--budget", "0.1"]);
	assert.deepEqual({ runs: o.runs, arms: o.arms, perSkill: o.perSkill, nearMiss: o.nearMiss, concurrency: o.concurrency, timeout: o.timeout, project: o.project }, { runs: 3, arms: ["full"], perSkill: 2, nearMiss: 3, concurrency: 3, timeout: 120, project: "sample" });
	assert.equal(parseOptions(["--help"]).help, true);
});

test("pickItems thins every group evenly, keeps the case's numbering, and covers every skill", () => {
	const all = pickItems(ITEMS, { perSkill: 4, nearMiss: 10 });
	assert.equal(all.length, ITEMS.length);
	const some = pickItems(ITEMS, { perSkill: 2, nearMiss: 3 });
	assert.equal(some.length, 6 * 2 + 3);
	for (const s of SKILLS.map(bareName)) assert.equal(some.filter((i) => i.ok[0] === s).length, 2, s);
	assert.equal(some.filter((i) => i.ok.includes("none")).length, 3);
	for (const i of some) assert.equal(ITEMS[i.index - 1].request, i.request, "index is the request's number in the case");
	assert.deepEqual(pickItems(ITEMS, { perSkill: 1, nearMiss: 0 }).map((i) => i.ok[0]), SKILLS.map(bareName).sort((a, b) => ITEMS.findIndex((x) => x.ok[0] === a) - ITEMS.findIndex((x) => x.ok[0] === b)));
});

test("firstChoice reads the first tool the model called: a skill by its short name, another tool as none, text as none", () => {
	const skill = (name) => ({ type: "assistant", message: { content: [{ type: "text", text: "x" }, { type: "tool_use", name: "Skill", input: { skill: name } }] } });
	assert.deepEqual(firstChoice([skill("stack-agent:debug")]), { answer: "debug", tool: "Skill", skill: "stack-agent:debug" });
	assert.deepEqual(firstChoice([skill("verify")]).answer, "verify");
	assert.deepEqual(firstChoice([{ type: "assistant", message: { content: [{ type: "tool_use", name: "Glob", input: {} }] } }, skill("stack-agent:debug")]), { answer: "none", tool: "Glob", skill: null }, "only the first tool counts");
	assert.deepEqual(firstChoice([{ type: "assistant", message: { content: [{ type: "text", text: "no tool" }] } }, { type: "result" }]), { answer: "none", tool: null, skill: null });
	assert.deepEqual(firstChoice([null, { type: "assistant", message: { content: "text" } }, { type: "assistant", message: { content: [null, { type: "tool_use", name: "Skill", input: {} }] } }]).answer, "unknown", "odd events do not crash");
	assert.equal(bareName("superpowers:systematic-debugging"), "systematic-debugging");
});

test("judge: a request for one of ours needs that skill, one that needs none is right with none or with a skill of another plugin", () => {
	const debug = ITEMS.find((i) => i.ok[0] === "debug");
	const none = ITEMS.find((i) => i.ok.includes("none"));
	assert.equal(judge(debug, "debug"), true);
	assert.equal(judge(debug, "verify"), false);
	assert.equal(judge(debug, "systematic-debugging"), false, "another plugin's skill is not the one asked for");
	assert.equal(judge(debug, "none"), false);
	assert.equal(judge(none, "none"), true);
	assert.equal(judge(none, "using-superpowers"), true, "any skill that is not ours");
	assert.equal(judge(none, "debug"), false);
	assert.equal(judge(none, "add-endpoint"), false);
});

test("the claude command line: a real session in a bare folder with the plugin loaded, user settings off", () => {
	const args = liveArgs({ request: "do it", model: "sonnet", budget: 0.1, plugins: ["/p", "/sp"] });
	assert.deepEqual(args.slice(0, 2), ["-p", "do it"]);
	for (const flag of ["--setting-sources", "--strict-mcp-config", "--verbose"]) assert.ok(args.includes(flag), flag);
	assert.equal(args[args.indexOf("--setting-sources") + 1], "project,local");
	assert.deepEqual(args.filter((a, i) => args[i - 1] === "--plugin-dir"), ["/p", "/sp"]);
	assert.equal(args[args.indexOf("--output-format") + 1], "stream-json");
	for (const bad of ["--dangerously-skip-permissions", "--permission-mode", "--allowedTools", "--add-dir"]) assert.ok(!args.includes(bad), `${bad} would let a session do more than ask which skill it loads`);
	assert.deepEqual(armPlugins("full", { plugin: "/p", superpowers: "/sp" }), ["/p"]);
	assert.deepEqual(armPlugins("full+superpowers", { plugin: "/p", superpowers: "/sp" }), ["/p", "/sp"]);
	assert.throws(() => armPlugins("none", {}), ConfigError);
});

test("--only runs exactly the requests named, with their numbers in the case's list", async () => {
	const fake = fakeClaude("right");
	const r = await run(fake, ["--runs", "2", "--only", "7,17,28"]);
	assert.equal(r.code, 0, r.text);
	assert.equal(fake.calls().length, 6);
	assert.match(r.text, /^full: 6\/6 sessions right/m);
	assert.deepEqual([...r.text.matchAll(/^ {2}ok +(\d+) want/gm)].map((m) => m[1]), ["7", "17", "28"]);
});

test("--requests runs the requests in a file, numbered from 1, and checks the file before any session starts", async () => {
	const dir = tempDir("stack-agent-live-requests-");
	const file = path.join(dir, "mine.json");
	write(dir, "mine.json", JSON.stringify([
		{ request: "run the checks and tell me if it holds", ok: ["verify"] },
		{ request: "add a DELETE /items route", ok: ["add-endpoint", "add-migration"] },
		{ request: "Prove it works for the importer", ok: ["debug"] },
		{ request: "what does this regex do", ok: ["none"] },
	]));
	const fake = fakeClaude("right");
	const r = await run(fake, ["--runs", "1", "--requests", file]);
	assert.equal(r.code, 0, r.text);
	assert.equal(fake.calls().length, 4);
	assert.match(r.text, /^full: 3\/4 sessions right/m);
	assert.match(r.text, /MISS +3 want debug, got stack-agent:verify/);
	assert.match(r.text, /^ {2}ok +4 want none/m);
	let n = 0;
	const bad = (list) => {
		const name = `bad${++n}.json`;
		write(dir, name, typeof list === "string" ? list : JSON.stringify(list));
		return parseOptions(["--model", "m", "--budget", "1", "--requests", path.join(dir, name)]);
	};
	assert.throws(() => bad("{not json"), /--requests: cannot read/);
	assert.throws(() => bad([]), /non-empty JSON array/);
	assert.throws(() => bad([{ request: "  ", ok: ["verify"] }]), /item 1 needs a request/);
	assert.throws(() => bad([{ request: "x", ok: [] }]), /item 1: ok must list skills/);
	assert.throws(() => bad([{ request: "x", ok: ["nope"] }]), /item 1: ok must list skills/);
	assert.throws(() => bad([{ request: "x", ok: ["none", "verify"] }]), /none cannot be listed with a skill/);
	assert.throws(() => bad([{ request: "  --top flag: what does it do", ok: ["none"] }]), /cannot start with "-"/);
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--requests", file, "--only", "1"]), /cannot be used together/);
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--requests", path.join(dir, "missing.json")]), /--requests: cannot read/);
});

test("the extra requests shipped next to the case are valid for --requests and do not repeat the case's own", () => {
	const file = path.join(repoRoot, "scripts", "micro", "cases", "skill-routing-extra.json");
	const extra = readRequests(file);
	assert.ok(extra.length >= 30, `${extra.length} requests`);
	const own = new Set(ITEMS.map((x) => x.request));
	assert.deepEqual(extra.filter((x) => own.has(x.request)), []);
	const wanted = new Set(extra.flatMap((x) => x.ok));
	for (const skill of ["add-migration", "api-map", "feature-map", "verify", "debug", "add-endpoint", "none"]) assert.ok(wanted.has(skill), `${skill} has a request`);
});

test("dry run prints the requests and the most the run can cost, and never calls claude", async () => {
	const fake = fakeClaude();
	const r = await run(fake, ["--runs", "2", "--dry-run"]);
	assert.equal(r.code, 0);
	assert.match(r.text, /^15 requests x 2 runs x 1 arm\(s\) = 30 sessions, budgets add up to \$3\.00 \(dry run\)/);
	assert.match(r.text, /want debug: /);
	assert.equal(fake.calls().length, 0);
});

test("a model that loads the right skill for every request scores all right, and each session is an empty folder with the plugin", async () => {
	const fake = fakeClaude("right");
	const r = await run(fake, ["--runs", "2", "--per-skill", "2", "--near-miss", "3"]);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /^full: 30\/30 sessions right \(100%\)/m);
	assert.doesNotMatch(r.text, /MISS/);
	const calls = fake.calls();
	assert.equal(calls.length, 30);
	assert.equal(new Set(calls.map((c) => c.cwd)).size, 30, "every session has a folder of its own");
	for (const c of calls) {
		assert.ok(!fs.existsSync(c.cwd), "and it is removed afterwards");
		assert.ok(c.argv.includes("--plugin-dir") && c.argv[c.argv.indexOf("--plugin-dir") + 1] === repoRoot);
	}
	const saved = JSON.parse(fs.readFileSync(r.text.match(/results: (.+results\.json)/)[1], "utf8"));
	assert.equal(saved.rows.length, 30);
	assert.deepEqual(saved.meta.requests.length, 15);
	assert.equal(saved.rows.find((x) => x.index === 1).answer, "debug");
});

test("by default a session starts in a Stack Agent sample project: the HTTP backend, or the CLI for a request about a command line", async () => {
	const fake = fakeClaude("right");
	const r = await run(fake, ["--runs", "1", "--per-skill", "1", "--near-miss", "0", "--project", "sample", "--concurrency", "2"]);
	assert.equal(r.code, 0, r.text);
	const calls = fake.calls();
	assert.equal(calls.length, 6);
	assert.equal(calls.filter((c) => c.files.includes("package.json")).length, 5, "five requests are about an HTTP backend");
	assert.equal(calls.filter((c) => c.files.includes("wordfreq")).length, 1, "the request about the --top flag is in the CLI project");
	for (const c of calls) assert.ok(c.files.includes(".stack-agent"), "and Stack Agent is set up in it");
	assert.match(r.text, /^full: 6\/6 sessions right/m);
});

test("a model that starts with another tool, or answers in text, loads no skill: right only where none was wanted", async () => {
	for (const mode of ["glob", "none"]) {
		const r = await run(fakeClaude(mode), ["--runs", "1", "--per-skill", "2", "--near-miss", "3"]);
		assert.equal(r.code, 0, r.text);
		assert.match(r.text, /^full: 3\/15 sessions right \(20%\)/m, mode);
		assert.equal((r.text.match(/MISS/g) ?? []).length, 12, mode);
		assert.match(r.text, mode === "glob" ? /got \(Glob\)/ : /got \(no tool\)/);
	}
});

test("only the first tool call counts: a skill loaded after another tool is not a load", async () => {
	const fake = fakeClaude("late");
	const r = await run(fake, ["--runs", "1", "--per-skill", "1", "--near-miss", "0"]);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /^full: 6\/6 sessions right/m, "the first call is the right skill; the later debug call is ignored");
});

test("a session where the plugin did not load is invalid and fails the run loudly instead of scoring", async () => {
	const r = await run(fakeClaude("broken"), ["--runs", "1", "--per-skill", "1", "--near-miss", "0"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /0\/0 sessions right.*6 not measured/);
	assert.match(r.text, /INVALID \(full, request \d+\): stack-agent did not load/);
});

test("a session that gives no first tool call in time is an error with its reason, and is stopped", async () => {
	const fake = fakeClaude("slow");
	const item = pickItems(ITEMS, { perSkill: 1, nearMiss: 0 })[0];
	const t = Date.now();
	const row = await measure({ claude: { command: process.execPath, prefix: [fake.bin] }, item, arm: "full", run: 1, opts: { model: "m", budget: 0.1, timeout: 1, plugin: repoRoot, superpowers: null, project: "bare", workBase: tempDir() }, env: process.env });
	assert.match(row.error, /no first tool call or answer within 1 s/, JSON.stringify(row));
	assert.ok(Date.now() - t < 20000, "it did not wait for the 60 s the fake needs");
});

test("runSession stops a claude that keeps running after its first tool call, and returns only once it is gone", async () => {
	const fake = fakeClaude("stays");
	const t = Date.now();
	const s = await runSession({ claude: { command: process.execPath, prefix: [fake.bin] }, args: ["-p", "Prove it works"], cwd: tempDir(), env: process.env, timeoutMs: 60000 });
	assert.ok(Date.now() - t < 20000, "it did not wait for the session to end or time out");
	assert.equal(s.timedOut, false);
	assert.ok(s.lines.some((l) => l.includes('"tool_use"')));
	assert.equal(s.exited, true, "the process had exited when it returned, so its folder can be removed");
	// and it is not left running: the fake writes a beat every 50 ms while it lives, and none may come after it returned
	const before = fake.beat();
	await new Promise((r) => setTimeout(r, 600));
	assert.equal(fake.beat(), before, "claude kept running after runSession returned");
});

test("runSession stops claude at the first tool call and reports a missing program", async () => {
	const fake = fakeClaude("right");
	const s = await runSession({ claude: { command: process.execPath, prefix: [fake.bin] }, args: ["-p", "Prove it works"], cwd: tempDir(), env: process.env, timeoutMs: 20000 });
	assert.ok(s.lines.length >= 2 && s.lines.some((l) => l.includes('"tool_use"')));
	const missing = await runSession({ claude: { command: path.join(tempDir(), "no-such-claude"), prefix: [] }, args: [], cwd: tempDir(), env: process.env, timeoutMs: 5000 });
	assert.ok(missing.error, "a program that cannot start is an error, not a hang");
});

test("--total-budget stops starting sessions when the next one would pass it", async () => {
	const fake = fakeClaude("right");
	const r = await run(fake, ["--runs", "2", "--per-skill", "2", "--near-miss", "3", "--total-budget", "0.35", "--concurrency", "1"]);
	assert.equal(fake.calls().length, 3, "0.35 allows three sessions of 0.1");
	assert.match(r.text, /stopped: the next session would pass --total-budget \$0\.35; 3 of 30 sessions ran/);
});

test("the summary counts what was measured and names the requests that missed", () => {
	const rows = [
		{ arm: "full", run: 1, index: 1, request: "r1", expected: ["debug"], tool: "Skill", skill: "stack-agent:debug", answer: "debug", right: true, cost: 0.01 },
		{ arm: "full", run: 2, index: 1, request: "r1", expected: ["debug"], tool: "Skill", skill: "superpowers:systematic-debugging", answer: "systematic-debugging", right: false, cost: 0.02 },
		{ arm: "full", run: 1, index: 5, request: "r5", expected: ["verify"], error: "boom" },
	];
	const text = summarize(rows, { arms: ["full"] });
	assert.match(text, /full: 1\/2 sessions right \(50%\), 1 not measured/);
	assert.match(text, /MISS {1,2}1 want debug, got stack-agent:debug, superpowers:systematic-debugging/);
	assert.match(text, /MISS {1,2}5 want verify, got error/);
	assert.match(text, /cost of the 2 sessions that reported one: \$0\.030/);
});

test("CLI: usage errors exit 2 and --help prints the usage", () => {
	const bad = spawnSync(process.execPath, [script, "--model", "m"], { encoding: "utf8" });
	assert.equal(bad.status, 2);
	assert.match(bad.stderr, /--budget must be a positive number/);
	const help = spawnSync(process.execPath, [script, "--help"], { encoding: "utf8" });
	assert.equal(help.status, 0);
	assert.match(help.stdout, /^usage: node scripts\/micro\/routing-live\.mjs/);
	// every option the parser takes is in the usage, and the paths in it are written whole
	for (const opt of ["model", "budget", "runs", "arms", "superpowers", "per-skill", "near-miss", "only", "concurrency", "project", "timeout", "total-budget", "plugin", "work-dir", "out", "dry-run", "json"]) assert.ok(help.stdout.includes(`--${opt}`), `--${opt} is not in the usage`);
	assert.match(help.stdout, /C:\/Users\/Public/);
	assert.doesNotMatch(help.stdout, /C:Users|\bundefined\b|\[object/);
});

test("a session that stops after some text, with no tool call and no answer, is an error and not a 'no skill' answer", async () => {
	const fake = fakeClaude("hang");
	const item = pickItems(ITEMS, { perSkill: 1, nearMiss: 0 })[0];
	const row = await measure({ claude: { command: process.execPath, prefix: [fake.bin] }, item, arm: "full", run: 1, opts: { model: "m", budget: 0.1, timeout: 2, plugin: repoRoot, superpowers: null, project: "bare", workBase: tempDir() }, env: process.env });
	assert.match(row.error, /no first tool call or answer within 2 s/);
	assert.equal(row.right, undefined, "and it is not scored");
	const near = pickItems(ITEMS, { perSkill: 0 > 1 ? 1 : 1, nearMiss: 1 }).find((i) => i.ok.includes("none"));
	const row2 = await measure({ claude: { command: process.execPath, prefix: [fake.bin] }, item: near, arm: "full", run: 1, opts: { model: "m", budget: 0.1, timeout: 2, plugin: repoRoot, superpowers: null, project: "bare", workBase: tempDir() }, env: process.env });
	assert.equal(row2.right, undefined, "not even a request that wants no skill counts it as right");
});

test("a result that is not a success (a budget cap, an error) is an error even when it says is_error false, and a failed login is named", async () => {
	const r = await run(fakeClaude("budget"), ["--runs", "1", "--only", "25"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /ERROR \(full, request 25\): claude did not answer \(error_max_budget_usd\)/);
	assert.match(r.text, /0\/0 sessions right.*1 not measured/);
	const login = await run(fakeClaude("nologin"), ["--runs", "1", "--only", "25"]);
	assert.equal(login.code, 1);
	assert.match(login.text, /ERROR \(full, request 25\): claude did not start a session: Not logged in/);
	assert.doesNotMatch(login.text, /INVALID/, "a missing init event is not an isolation failure");
});

test("a plugin that loads but lists none of its skills is invalid, not a miss", async () => {
	const r = await run(fakeClaude("noskills"), ["--runs", "1", "--only", "1"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /INVALID \(full, request 1\): the session does not list these skills of the plugin: add-endpoint, add-migration, api-map, debug, feature-map, verify/);
});

test("a skill that only a person starts is still one of ours: loading it for a request that needs none is wrong", async () => {
	const r = await run(fakeClaude("hidden"), ["--runs", "1", "--only", "25"]);
	assert.match(r.text, /^full: 0\/1 sessions right/m);
	assert.match(r.text, /MISS +25 want none, got stack-agent:correct/);
	// an unreadable skill name is not an answer, and the older input key still reads
	assert.equal(firstChoice([{ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: {} }] } }]).answer, "unknown");
	assert.equal(firstChoice([{ type: "assistant", message: { content: [{ type: "tool_use", name: "Skill", input: { command: "stack-agent:debug" } }] } }]).answer, "debug");
	const none = ITEMS.find((i) => i.ok.includes("none"));
	assert.equal(judge(none, "unknown"), false);
	assert.equal(judge(none, "correct"), false, "correct is a skill of ours that no model may start");
	assert.equal(judge(ITEMS[0], "unknown"), false);
});

test("a setup failure becomes an error row for that session and the other sessions still report", async () => {
	const fake = fakeClaude("right");
	const item = pickItems(ITEMS, { perSkill: 1, nearMiss: 0 })[0];
	const opts = { model: "m", budget: 0.1, timeout: 20, plugin: repoRoot, superpowers: null, project: "sample", workBase: tempDir() };
	const claude = { command: process.execPath, prefix: [fake.bin] };
	const bad = await measure({ claude, item, arm: "full", run: 1, opts, env: process.env, scaffoldProject: () => { throw new Error("git is missing"); } });
	assert.match(bad.error, /session failed: git is missing/);
	assert.equal(fake.calls().length, 0, "no claude was started for it");
	const good = await measure({ claude, item, arm: "full", run: 1, opts: { ...opts, project: "bare" }, env: process.env });
	assert.equal(good.right, true);
});

test("every tool is refused by a hook, and no session file is kept", async () => {
	const args = liveArgs({ request: "x", model: "m", budget: 0.1, plugins: ["/p"] });
	assert.ok(args.includes("--no-session-persistence"));
	const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
	const hook = settings.hooks.PreToolUse[0];
	assert.equal(hook.matcher, undefined, "no matcher: every tool");
	const command = hook.hooks[0].command;
	assert.match(command, /deny-tools-hook\.mjs"$/);
	assert.ok(!command.includes("\\"), "forward slashes work in both shells");
	const script = command.match(/"([^"]*deny-tools-hook\.mjs)"$/)[1];
	assert.ok(fs.existsSync(script));
	const out = spawnSync(process.execPath, [script], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command: "rm x" } }), encoding: "utf8" });
	assert.equal(out.status, 2, "exit 2 blocks the tool even if the printed answer is lost");
	assert.match(out.stderr, /no tool runs/);
	const decision = JSON.parse(out.stdout).hookSpecificOutput;
	assert.deepEqual({ event: decision.hookEventName, decision: decision.permissionDecision }, { event: "PreToolUse", decision: "deny" });
});

test("--total-budget is counted in whole millionths of a dollar: three sessions of $0.10 fit in $0.30", async () => {
	const fake = fakeClaude("right");
	const r = await run(fake, ["--runs", "1", "--only", "1,2,3,4", "--total-budget", "0.3", "--concurrency", "1"]);
	assert.equal(fake.calls().length, 3);
	assert.match(r.text, /stopped: the next session would pass --total-budget \$0\.3; 3 of 4 sessions ran/);
});

test("--concurrency runs that many sessions at once", async () => {
	const t = Date.now();
	const fake = fakeClaude("pause");
	const r = await run(fake, ["--runs", "1", "--only", "1,2,3,4", "--concurrency", "4"]);
	assert.equal(r.code, 0, r.text);
	assert.ok(Date.now() - t < 2200, `4 sessions of 600 ms in parallel took ${Date.now() - t} ms`);
	assert.equal(fake.calls().length, 4);
});

test("sessions run under --work-dir, and the memory files above it are named instead of hidden", async () => {
	const base = tempDir("stack-agent-live-work-");
	write(base, "CLAUDE.md", "# a playbook\n");
	const fake = fakeClaude("right");
	const r = await run(fake, ["--runs", "1", "--only", "1,2", "--work-dir", path.join(base, "inner")]);
	assert.equal(r.code, 0, r.text);
	for (const c of fake.calls()) assert.ok(c.cwd.startsWith(path.join(base, "inner")), c.cwd);
	const saved = JSON.parse(fs.readFileSync(r.text.match(/results: (.+results\.json)/)[1], "utf8"));
	assert.deepEqual(saved.meta.memoryFilesRead.filter((f) => f.startsWith(base)), [path.join(base, "CLAUDE.md")]);
	assert.equal(saved.meta.workDir, path.join(base, "inner"));
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1", "--work-dir"]), /--work-dir needs a value/);
});

test("memoryFilesAbove finds every CLAUDE.md a session would read, and pickWorkBase avoids them without making folders it does not use", () => {
	const root = tempDir("stack-agent-memory-");
	write(root, "a/CLAUDE.md", "x");
	write(root, "a/b/.claude/CLAUDE.local.md", "x");
	const home = path.join(root, "home");
	assert.deepEqual(memoryFilesAbove(path.join(root, "a", "b", "c"), { home }).filter((f) => f.startsWith(root)), [path.join(root, "a", "b", ".claude", "CLAUDE.local.md"), path.join(root, "a", "CLAUDE.md")]);
	assert.deepEqual(memoryFilesAbove(path.join(root, "clean"), { home }).filter((f) => f.startsWith(root)), []);
	write(root, "home/.claude/CLAUDE.md", "x");
	assert.ok(memoryFilesAbove(path.join(root, "clean"), { home }).includes(path.join(home, ".claude", "CLAUDE.md")), "the user's own file counts wherever the session runs");

	const clean = tempDir("stack-agent-clean-");
	const noHome = path.join(clean, "nohome");
	// the machine's own memory files (a CLAUDE.md in the real home) are out of the question here: only those under `root` count
	const find = (dir) => memoryFilesAbove(dir, { home: noHome }).filter((f) => f.startsWith(root));
	const picked = pickWorkBase({ candidates: [path.join(root, "a", "b"), clean], home: noHome, find });
	assert.equal(picked.base, path.join(clean, "stack-agent-work"));
	assert.deepEqual(picked.memory, []);
	assert.ok(!fs.existsSync(path.join(root, "a", "b", "stack-agent-work")), "no folder was made for the candidate that was passed over");
	const stuck = pickWorkBase({ candidates: [path.join(root, "a", "b")], home: noHome, find });
	assert.equal(stuck.base, path.join(root, "a", "b", "stack-agent-work"));
	assert.ok(stuck.memory.includes(path.join(root, "a", "CLAUDE.md")), "with nowhere clean, the files that will be read are listed");

	// the user's own ~/.claude/CLAUDE.md is read wherever a session runs: it must not make every candidate look dirty
	const withHome = (dir) => memoryFilesAbove(dir, { home }).filter((f) => f.startsWith(root));
	const viaHome = pickWorkBase({ candidates: [path.join(root, "a", "b"), clean], home, find: withHome });
	assert.equal(viaHome.base, path.join(clean, "stack-agent-work"), "the clean candidate wins although the home file is read in both");
	assert.deepEqual(viaHome.memory, [path.join(home, ".claude", "CLAUDE.md")], "and the home file is still listed");
	// with nowhere clean, the folder with the fewest files is taken, not the first
	const fewest = pickWorkBase({ candidates: [path.join(root, "a", "b"), path.join(root, "a")], home, find: withHome });
	assert.equal(fewest.base, path.join(root, "a", "stack-agent-work"));
	assert.equal(pickWorkBase({ requested: path.join(clean, "mine"), home: noHome, find }).base, path.join(clean, "mine"));
	write(clean, "afile", "x");
	assert.throws(() => pickWorkBase({ requested: path.join(clean, "afile", "x"), home: noHome, find }), /cannot write in/);
	assert.throws(() => pickWorkBase({ candidates: [path.join(clean, "afile", "y")], home: noHome, find }), /no writable folder/);
});
