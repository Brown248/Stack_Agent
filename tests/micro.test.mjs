// The micro-test harness, run against a fake claude so no test spends money.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { CONTROL, checkCase, loadCase, microArgs, parseOptions, pickVariants, summarize, toScore } from "../scripts/micro/run.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { coverageMessage, importMessage } from "../scripts/hooks/stop-verify.mjs";
import { memoryFilesAbove } from "../scripts/micro/work-dir.mjs";
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
	assert.deepEqual(pickVariants(c, null), ["control", "before-4af59f0", "current", "current-th"]);
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

test("the coverage and guard cases use the Stop hook's current messages and score the right next step", async () => {
	const files = ["src/modules/items/service.js"];
	const behavior = await loadCase("coverage-request");
	assert.equal(behavior.variants.current, coverageMessage(files).trim());
	assert.equal(behavior.score('test("rejects a long name", async () => { const r = await post({ name: "x".repeat(51) }); assert.equal(r.status, 400); });'), true);
	assert.equal(behavior.score("The change is covered by the existing tests, so I stop."), false);
	assert.equal(behavior.score('test("long name", () => assert.equal(res.status, 400))'), false, "no name over 50 characters");

	const refactor = await loadCase("coverage-refactor");
	assert.equal(refactor.variants.current, coverageMessage(files).trim());
	assert.equal(refactor.score("This is a refactor: nothing a user can observe changed, and the existing tests cover it. I stop here."), true);
	assert.equal(refactor.score('It is a refactor, but I add:\n```js\ntest("cleanName trims", () => assert.equal(cleanName(" a "), "a"));\n```'), false);
	assert.equal(refactor.score("I add a test for cleanName."), false, "does not say it is a refactor");

	const guard = await loadCase("guard-request");
	assert.match(guard.variants.current, /never raise the baseline/);
	assert.ok(guard.prompt(null).includes("[no-sql-in-controller]") && !guard.prompt(null).includes("stack-agent:"), "the control shows only the guard output");
	const fixed = "Move it to the repository:\n```js\n// src/modules/items/repository.js\nexport function countItems() { return db.get(\"SELECT COUNT(*) AS total FROM items\").total; }\n```";
	assert.equal(guard.score(fixed), true);
	assert.equal(guard.score(`${fixed}\nThen node .stack-agent/bin/guard.mjs --update-baseline --allow-increase`), false);
	assert.equal(guard.score("// stack-agent-allow no-sql-in-controller reason=\"count\" until=2026-11-01 by=me"), false);
	assert.equal(guard.score("I will move the query into the repository."), false, "a promise with no edit");
});

test("skip-excuses hands the agent the verify skill as shipped, with and without the excuses table, and scores the full run with a check", async () => {
	const c = await loadCase("skip-excuses");
	const shipped = fs.readFileSync(path.join(repoRoot, "skills", "verify", "SKILL.md"), "utf8");
	assert.ok(c.variants.current.includes("The final run must be the full one with no flags") && !c.variants.current.startsWith("---"), "the skill body, without its front matter");
	assert.ok(shipped.includes(c.variants.current.slice(0, 60)));
	assert.ok(c.variants["with-table"].startsWith(c.variants.current) && c.variants["with-table"].includes("Excuses that do not hold"));
	assert.equal(c.variants.control, null);
	assert.match(c.prompt(null), /No skill is loaded/);
	const good = "Add to verify.json a command check that calls the service with a name of 51 chars and expects 400, then run:\nnode .stack-agent/bin/verify.mjs";
	assert.equal(c.score(good), true);
	assert.equal(c.score(good.replace("verify.mjs", "verify.mjs --skip \"no token for the server\"")), false, "a skip is not the full run");
	assert.equal(c.score(good.replace("verify.mjs", "verify.mjs --check long-name")), false, "one check is not the full run");
	assert.equal(c.score(good.replace("verify.mjs", "verify.mjs --skip-tests")), false, "nor is a run without the suite");
	assert.equal(c.score("I will read the service first."), false);
	assert.equal(c.score("node .stack-agent/bin/verify.mjs"), false, "no check for the new rule");
});

test("skill-routing lists the skills the model may invoke as shipped, and scores the share of requests answered right", async () => {
	const { ITEMS, parseAnswers, scoreAnswers, shippedSkills } = await import("../scripts/micro/cases/skill-routing.mjs");
	const c = await loadCase("skill-routing");
	const skills = shippedSkills();
	const visible = skills.filter((s) => !s.hidden).map((s) => s.name);
	assert.deepEqual(visible, ["add-endpoint", "add-migration", "api-map", "debug", "feature-map", "verify"], "the listing is the skills a person does not have to start");
	for (const s of skills.filter((x) => x.hidden)) assert.ok(!c.variants.current.includes(`stack-agent:${s.name}`), `${s.name} sets disable-model-invocation, so the model is not shown it`);
	for (const name of visible) assert.ok(c.variants.current.includes(`- stack-agent:${name}: `) && c.variants["names-only"].includes(`- stack-agent:${name}\n`.replace(/\n$/, "")), name);
	assert.ok(!c.variants["names-only"].includes("Use when"), "names-only has no description");
	// the crowded listings hold the same skills of ours first, then other plugins' skills
	const { DISTRACTORS } = await import("../scripts/micro/cases/skill-routing.mjs");
	assert.ok(DISTRACTORS.length >= 8 && DISTRACTORS.every((d) => d.name && d.description));
	assert.ok(c.variants.crowded.startsWith(c.variants.current) && c.variants["crowded-names-only"].startsWith(c.variants["names-only"]));
	for (const d of DISTRACTORS) assert.ok(c.variants.crowded.includes(`- ${d.name}: ${d.description}`) && c.variants["crowded-names-only"].includes(`- ${d.name}`), d.name);
	assert.ok(!c.variants["crowded-names-only"].includes("Use when"));
	assert.equal(c.variants.current, c.variants.current.trim());
	// every right answer is a skill in the listing or none, every skill is asked about, and so are the near-misses
	const allowed = new Set([...visible, "none"]);
	for (const item of ITEMS) for (const ok of item.ok) assert.ok(allowed.has(ok), `${item.request}: ${ok}`);
	for (const name of visible) assert.ok(ITEMS.filter((i) => i.ok.includes(name)).length >= 3, `${name} has at least three requests`);
	assert.ok(ITEMS.filter((i) => i.ok.includes("none")).length >= 8);
	assert.ok(c.prompt(null).includes(`Below are ${ITEMS.length} requests`) && c.prompt(null).includes("No skills are available to load."));
	assert.ok(c.prompt("- stack-agent:debug: x").includes("- stack-agent:debug: x") && !c.prompt("- stack-agent:debug: x").includes("No skills are available"));

	const perfect = ITEMS.map((item, i) => `${i + 1}: ${item.ok[0] === "none" ? "none" : `stack-agent:${item.ok[0]}`}`).join("\n");
	assert.equal(scoreAnswers(perfect), 1);
	assert.equal(scoreAnswers(ITEMS.map((_, i) => `${i + 1}: none`).join("\n")), ITEMS.filter((i) => i.ok.includes("none")).length / ITEMS.length, "the control's best case: right only where nothing is needed");
	assert.equal(scoreAnswers(""), 0);
	assert.equal(c.score(perfect), 1);
	// a request that needs none of ours may go to another plugin's skill, but not to one of ours, and not to a made-up one
	const firstNone = ITEMS.findIndex((i) => i.ok.includes("none")) + 1;
	const answerFor = (answer) => perfect.split("\n").map((l) => (l.startsWith(`${firstNone}:`) ? `${firstNone}: ${answer}` : l)).join("\n");
	assert.equal(scoreAnswers(answerFor("superpowers:test-driven-development")), 1);
	assert.equal(scoreAnswers(answerFor("stack-agent:verify")), (ITEMS.length - 1) / ITEMS.length);
	assert.equal(scoreAnswers(answerFor("made-up-skill")), (ITEMS.length - 1) / ITEMS.length);
	// the shapes a reply comes in
	assert.deepEqual(parseAnswers("1: debug\n2. **stack-agent:verify**\n3) None\n4 - add-endpoint (because it is a route)\n`5`: n/a\nsome chatter\n6: debug, verify\n1: verify"), { 1: "debug", 2: "verify", 3: "none", 4: "add-endpoint", 5: "none", 6: "debug" }, "the first answer to a number counts");
	assert.equal(scoreAnswers(perfect.replace("1: stack-agent:debug", "1: verify")), (ITEMS.length - 1) / ITEMS.length, "a wrong skill is wrong");
	assert.equal(scoreAnswers(perfect.replace("1: stack-agent:debug", "1: made-up-skill")), (ITEMS.length - 1) / ITEMS.length, "an unknown skill is wrong");
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
	assert.equal(out.calls, 16);
	assert.ok(Math.abs(out.maxCost - 0.8) < 1e-9, String(out.maxCost));
	assert.deepEqual(Object.keys(out.prompts), ["control", "before-4af59f0", "current", "current-th"]);
	assert.match(r.stderr, /16 calls, at most \$0\.80 \(dry run\)/);
});

test("end to end with a fake claude: rounds across variants, an empty folder per call, results saved and summarized", () => {
	const fake = fakeClaude();
	const out = path.join(tempDir(), "out");
	const r = run(["--case", "import-request", "--model", "sonnet", "--budget", "0.05", "--runs", "2", "--variant", "before-4af59f0", "--variant", "current", "--out", out], { CLAUDE_BIN: fake.bin });
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

// claude reads a CLAUDE.md from the working folder and every folder above it whatever --setting-sources says; on Windows
// the system temp folder is inside the profile, so a call started there read the user's own playbook
test("each call runs in a folder whose memory files are known: --work-dir as given, or one chosen to have none above it", () => {
	const root = tempDir("stack-agent-work-");
	write(root, "CLAUDE.md", "# a playbook\n");
	const fake = fakeClaude();
	const out = path.join(tempDir(), "out");
	const inner = path.join(root, "inner");
	const r = run(["--case", "import-request", "--model", "sonnet", "--budget", "0.05", "--runs", "1", "--variant", "current", "--work-dir", inner, "--out", out], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 0, r.stderr + r.stdout);
	assert.ok(fake.calls().length > 0 && fake.calls().every((c) => c.cwd.startsWith(inner)), "every call ran under --work-dir");
	const saved = JSON.parse(fs.readFileSync(path.join(out, "results.json"), "utf8"));
	assert.equal(saved.meta.workDir, inner);
	assert.ok(saved.meta.memoryFilesRead.includes(path.join(root, "CLAUDE.md")));
	assert.match(r.stdout, /NOTE: every session also reads \d+ memory file\(s\) of yours: .*CLAUDE\.md/);
	// by default what it says it reads is what is above the folder it used, on any machine
	const fake2 = fakeClaude();
	const out2 = path.join(tempDir(), "out");
	const r2 = run(["--case", "import-request", "--model", "sonnet", "--budget", "0.05", "--runs", "1", "--variant", "current", "--out", out2], { CLAUDE_BIN: fake2.bin });
	assert.equal(r2.status, 0, r2.stderr + r2.stdout);
	const saved2 = JSON.parse(fs.readFileSync(path.join(out2, "results.json"), "utf8"));
	for (const c of fake2.calls()) assert.deepEqual(memoryFilesAbove(c.cwd), saved2.meta.memoryFilesRead, "the memory files recorded are the ones above the folder the call ran in");
});
