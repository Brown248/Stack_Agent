// The micro-test harness, run against a fake claude so no test spends money.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CONTROL, checkCase, loadCase, microArgs, parseOptions, pickVariants, summarize, toScore } from "../scripts/micro/run.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { importMessage } from "../scripts/hooks/stop-verify.mjs";
import { repoRoot, tempDir, write } from "./helpers.mjs";

const runScript = path.join(repoRoot, "scripts", "micro", "run.mjs");
const run = (args, env = {}) => spawnSync(process.execPath, [runScript, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

// answers like a model that adds a direct-call check only when the prompt shows one; records every argv it gets
function fakeClaude({ fail = false } = {}) {
	const dir = tempDir("stack-agent-micro-fake-");
	write(
		dir,
		"fake-claude.mjs",
		`import fs from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] === "--version") { console.log("9.9.9 (fake)"); process.exit(0); }
fs.appendFileSync(${JSON.stringify(path.join(dir, "calls.jsonl"))}, JSON.stringify({ argv, cwd: process.cwd(), files: fs.readdirSync(process.cwd()) }) + "\\n");
if (${fail}) { console.log(JSON.stringify({ is_error: true, result: "rate limited", total_cost_usd: 0 })); process.exit(1); }
const prompt = argv[argv.indexOf("-p") + 1];
const result = prompt.includes("import { monthlyTotals }") ? 'Add to .stack-agent/verify.json: "args": ["node", "-e", "console.log(monthlyTotals([]))"]' : "The new code is not reachable yet, so I stop here.";
console.log(JSON.stringify({ type: "result", is_error: false, result, total_cost_usd: 0.0021 }));
`,
	);
	return { bin: path.join(dir, "fake-claude.mjs"), calls: () => fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) };
}

test("options: case, model, and budget are required, runs default to 5 and stay in range", () => {
	assert.throws(() => parseOptions(["--model", "m", "--budget", "1"]), /--case is required/);
	assert.throws(() => parseOptions(["--case", "x", "--budget", "1"]), /--model is required/);
	assert.throws(() => parseOptions(["--case", "x", "--model", "m"]), /--budget must be a positive/);
	assert.throws(() => parseOptions(["--case", "x", "--model", "m", "--budget", "1", "--runs", "0"]), /--runs must be/);
	assert.throws(() => parseOptions(["--case", "x", "--model", "m", "--budget", "1", "--runs", "2.5"]), /--runs must be/);
	assert.equal(parseOptions(["--case", "x", "--model", "m", "--budget", "0.1"]).runs, 5);
});

test("a case needs prompt, score, better, and a control with no guidance", async () => {
	await assert.rejects(loadCase("../ab/run"), ConfigError);
	await assert.rejects(loadCase("no-such-case"), /no scripts[\\/]micro[\\/]cases[\\/]no-such-case\.mjs/);
	const c = await loadCase("import-request");
	assert.equal(c.variants[CONTROL], null);
	assert.deepEqual(pickVariants(c, null), ["control", "before-4af59f0", "current"]);
	assert.deepEqual(pickVariants(c, ["current"]), ["control", "current"], "the control always runs");
	assert.throws(() => pickVariants(c, ["nope"]), /--variant: nope not in case import-request/);
	const good = { prompt: () => "p", score: () => 1, better: "higher", variants: { control: null, a: "say a" } };
	assert.equal(checkCase("x", good).name, "x");
	assert.throws(() => checkCase("x", { ...good, prompt: "p" }), /prompt\(guidance\) must be a function/);
	assert.throws(() => checkCase("x", { ...good, score: undefined }), /score\(text\) must be a function/);
	assert.throws(() => checkCase("x", { ...good, better: "more" }), /better must be/);
	assert.throws(() => checkCase("x", { ...good, variants: { a: "say a" } }), /variants must include control: null/);
	assert.throws(() => checkCase("x", { ...good, variants: { control: "", a: "say a" } }), /variants must include control: null/);
	assert.throws(() => checkCase("x", { ...good, variants: { control: null, a: " " } }), /non-empty text/);
	assert.throws(() => checkCase("x", undefined), /case x:/);
});

test("the import-request case uses the Stop hook's current message and scores a direct call in verify.json", async () => {
	const c = await loadCase("import-request");
	assert.equal(c.variants.current, importMessage(["monthlyTotals"]).trim());
	assert.ok(!c.prompt(null).includes("Then this message arrived"), "the control has no hook message");
	assert.ok(c.prompt(c.variants.current).includes(c.variants.current));
	assert.equal(c.score('In .stack-agent/verify.json add "args": ["node", "-e", "import { monthlyTotals } from \'./src/report.js\'; console.log(monthlyTotals([]))"]'), true);
	assert.equal(c.score("I add a test for monthlyTotals."), false);
	assert.equal(c.score("Add a check to .stack-agent/verify.json that runs the job."), false);
	// the shape of every reply to the old wording in the first live run: it names the file and the function and refuses
	assert.equal(c.score("I'm not editing `.stack-agent/verify.json`, and I'm stopping here. `monthlyTotals(rows)` is exported from `src/report.js`, but nothing calls it."), false);
	assert.equal(c.score("I'd add a check to verify.json that calls monthlyTotals([]) directly."), false, "a check needs args or a command");
});

test("--rescore scores saved replies again with the current score(), without claude", () => {
	const file = path.join(tempDir(), "results.json");
	const refusal = "I'm not editing `.stack-agent/verify.json`. `monthlyTotals(rows)` is exported but nothing calls it.";
	const check = 'In .stack-agent/verify.json: { "args": ["node", "-e", "console.log(monthlyTotals([{date:\'2026-01-01\',amount:1}]))"] }';
	fs.writeFileSync(file, JSON.stringify({ meta: { case: "import-request" }, runs: [{ variant: "control", n: 1, text: refusal, score: 1 }, { variant: "current", n: 1, text: check, score: 0 }, { variant: "current", n: 2, error: "boom" }] }));
	const r = run(["--case", "import-request", "--rescore", file, "--json"], { CLAUDE_BIN: path.join(tempDir(), "does-not-exist.exe") });
	assert.equal(r.status, 0, r.stderr);
	assert.deepEqual(JSON.parse(r.stdout).runs.map((x) => x.score ?? "error"), [0, 1, "error"]);
	const text = run(["--case", "import-request", "--rescore", file]);
	assert.match(text.stdout, /current\s+1\/2\s+1\.00\s+1\s+1\s+1/);
	fs.writeFileSync(file, JSON.stringify({ meta: { case: "other" }, runs: [] }));
	assert.equal(run(["--case", "import-request", "--rescore", file]).status, 2, "a file for another case");
	fs.writeFileSync(file, "{}");
	assert.equal(run(["--case", "import-request", "--rescore", file]).status, 2, "no runs");
	assert.equal(run(["--case", "import-request", "--rescore", path.join(tempDir(), "missing.json")]).status, 2);
});

test("each call has no tools, no session file, and no user settings, plugins, or MCP servers", () => {
	const args = microArgs({ prompt: "hi", model: "sonnet", budget: 0.05 });
	assert.deepEqual(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2), ["--tools", ""]);
	for (const flag of ["--no-session-persistence", "--strict-mcp-config"]) assert.ok(args.includes(flag), flag);
	assert.equal(args[args.indexOf("--setting-sources") + 1], "project,local");
	assert.equal(args[args.indexOf("--max-budget-usd") + 1], "0.05");
	assert.equal(args[args.indexOf("--output-format") + 1], "json");
});

test("scores are numbers or booleans; anything else is a broken case", () => {
	assert.equal(toScore(true), 1);
	assert.equal(toScore(false), 0);
	assert.equal(toScore(2.5), 2.5);
	for (const bad of [null, undefined, "1", NaN, Infinity]) assert.throws(() => toScore(bad), /must return a number or a boolean/);
});

test("--dry-run prints each prompt and the most it can cost, and never calls claude", () => {
	const r = run(["--case", "import-request", "--model", "sonnet", "--budget", "0.05", "--runs", "4", "--dry-run", "--json"], { CLAUDE_BIN: path.join(tempDir(), "does-not-exist.exe") });
	assert.equal(r.status, 0, r.stderr);
	const out = JSON.parse(r.stdout);
	assert.equal(out.calls, 12);
	assert.ok(Math.abs(out.maxCost - 0.6) < 1e-9, String(out.maxCost));
	assert.deepEqual(Object.keys(out.prompts), ["control", "before-4af59f0", "current"]);
	assert.match(r.stderr, /12 calls, at most \$0\.60 \(dry run\)/);
});

test("end to end with a fake claude: rounds across variants, an empty folder per call, results saved and summarized", () => {
	const fake = fakeClaude();
	const out = path.join(tempDir(), "out");
	const r = run(["--case", "import-request", "--model", "sonnet", "--budget", "0.05", "--runs", "2", "--out", out], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 0, r.stderr + r.stdout);
	const calls = fake.calls();
	assert.equal(calls.length, 6);
	assert.ok(calls.every((c) => c.files.length === 0), "each call runs in an empty folder");
	assert.equal(new Set(calls.map((c) => c.cwd)).size, 6, "a new folder per call");
	for (const c of calls) assert.ok(!fs.existsSync(c.cwd), "the call folder is removed");
	const saved = JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"));
	assert.equal(saved.meta.claudeVersion, "9.9.9 (fake)");
	assert.deepEqual(saved.runs.map((x) => `${x.variant}#${x.n}`), ["control#1", "before-4af59f0#1", "current#1", "control#2", "before-4af59f0#2", "current#2"]);
	assert.deepEqual(saved.runs.map((x) => x.score), [0, 0, 1, 0, 0, 1]);
	assert.match(r.stdout, /current\s+2\/2\s+1\.00\s+1\s+1\s+0\s+\$0\.0021/);
	assert.match(r.stdout, /control\s+2\/2\s+0\.00/);
});

test("a failed call is counted as an error, not a score, and the run exits 1", () => {
	const fake = fakeClaude({ fail: true });
	const out = path.join(tempDir(), "out");
	const r = run(["--case", "import-request", "--model", "sonnet", "--budget", "0.05", "--runs", "1", "--variant", "current", "--out", out, "--json"], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 1);
	const saved = JSON.parse(r.stdout);
	assert.ok(saved.runs.every((x) => x.error && x.score === undefined), JSON.stringify(saved.runs));
	assert.match(summarize({ name: "import-request", better: "higher" }, saved.runs), /current\s+0\/1\s+-\s+-\s+-\s+1/);
});

test("usage errors exit 2", () => {
	assert.equal(run(["--model", "m", "--budget", "1"]).status, 2);
	assert.equal(run(["--case", "nope", "--model", "m", "--budget", "1", "--dry-run"]).status, 2);
});
