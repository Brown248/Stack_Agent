// The tuning loop, run against a fake claude so no test spends money.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { ConfigError } from "../scripts/lib/files.mjs";
import { checkScenarios, fisherOneSided, parseCandidates, parseOptions, pareto } from "../scripts/micro/tune.mjs";
import { memoryFilesAbove } from "../scripts/micro/work-dir.mjs";
import { repoRoot, tempDir, write } from "./helpers.mjs";

const script = path.join(repoRoot, "scripts", "micro", "tune.mjs");
const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

// A case with two scenarios to learn from and one held back. The fake model passes a scenario when the wording it
// was given says BETTER; "OVERFIT" passes the two learning scenarios and fails the held-back one.
function caseDir({ keep } = {}) {
	const dir = tempDir("stack-agent-tune-cases-");
	write(
		dir,
		"toy.mjs",
		`const mk = (name) => ({ name, prompt: (g) => "scenario " + name + (g ? "\\nguidance: " + g : ""), score: (t) => /pass/.test(t) });
export default {
	description: "toy: does the reply pass?",
	better: "higher",
	variants: { control: null, current: "do the thing", other: "unused" },
	${keep ? `keep: ${JSON.stringify(keep)},` : ""}
	prompt: mk("a").prompt,
	score: mk("a").score,
	scenarios: [mk("a"), mk("b"), mk("holdout")],
};
`,
	);
	return dir;
}

// answers as a proposer when asked to propose, and as the model under test otherwise; records every call
function fakeClaude({ candidates = ["BETTER: do the thing and say pass"], replyCost = 0.01, failFirst = 0, failAfter = Infinity } = {}) {
	const dir = tempDir("stack-agent-tune-fake-");
	write(
		dir,
		"fake-claude.mjs",
		`import fs from "node:fs";
const argv = process.argv.slice(2);
if (argv[0] === "--version") { console.log("9.9.9 (fake)"); process.exit(0); }
fs.appendFileSync(${JSON.stringify(path.join(dir, "calls.jsonl"))}, JSON.stringify({ argv, cwd: process.cwd() }) + "\\n");
const prompt = argv[argv.indexOf("-p") + 1];
const model = argv[argv.indexOf("--model") + 1];
const made = fs.readFileSync(${JSON.stringify(path.join(dir, "calls.jsonl"))}, "utf8").trim().split("\\n").length;
// calls ${failFirst} from the start fail once each; from call ${failAfter} on, every call fails
if (made <= ${failFirst} || made > ${failAfter}) { console.log(JSON.stringify({ type: "result", is_error: true, subtype: "error_max_budget_usd", result: "budget", total_cost_usd: 0.002 })); process.exit(1); }
let result;
if (prompt.includes("[stack-agent tune: propose]")) result = JSON.stringify({ candidates: ${JSON.stringify(candidates)} });
else if (prompt.includes("scenario holdout")) result = prompt.includes("OVERFIT") ? "fail" : prompt.includes("BETTER") ? "pass" : "fail";
else result = prompt.includes("BETTER") || prompt.includes("OVERFIT") ? "pass" : "fail";
console.log(JSON.stringify({ type: "result", is_error: false, result, total_cost_usd: ${replyCost}, model }));
`,
	);
	return { bin: path.join(dir, "fake-claude.mjs"), calls: () => fs.readFileSync(path.join(dir, "calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) };
}

const base = (cases, extra = []) => ["--case", "toy", "--cases-dir", cases, "--budget", "5", "--screen-runs", "2", "--confirm-runs", "4", "--rounds", "1", ...extra];

test("fisherOneSided: the chance of a split this lopsided or more if the two arms were the same", () => {
	assert.ok(Math.abs(fisherOneSided(5, 5, 0, 5) - 1 / 252) < 1e-9);
	assert.ok(Math.abs(fisherOneSided(3, 3, 0, 4) - 1 / 35) < 1e-9);
	assert.equal(fisherOneSided(0, 0, 0, 0), 1);
	assert.equal(fisherOneSided(2, 5, 4, 5) > 0.5, true, "worse than the other arm is not evidence of better");
	assert.ok(fisherOneSided(30, 30, 20, 30) < 0.001);
});

test("parseOptions: a case and a budget are required, and the defaults are the two-stage plan", () => {
	assert.throws(() => parseOptions(["--budget", "5"]), /--case is required/);
	assert.throws(() => parseOptions(["--case", "x"]), /--budget must be a positive/);
	assert.throws(() => parseOptions(["--case", "x", "--budget", "5", "--confirm-runs", "3"]), /--confirm-runs must be/);
	const o = parseOptions(["--case", "x", "--budget", "5"]);
	assert.equal(o.variant, "current");
	assert.equal(o.confirmRuns, 30);
	assert.equal(o.screenModel, "haiku");
	assert.equal(o.confirmModel, "sonnet");
	assert.ok(o.rounds >= 1 && o.candidates >= 2);
});

test("checkScenarios: two or more are needed, so one scenario cannot decide, and the last is held back", () => {
	const one = { name: "x", prompt: () => "", score: () => 1 };
	assert.throws(() => checkScenarios("c", { prompt: one.prompt, score: one.score }), /at least two scenarios/);
	assert.throws(() => checkScenarios("c", { scenarios: [one] }), /at least two scenarios/);
	const s = checkScenarios("c", { scenarios: [one, { ...one, name: "y" }, { ...one, name: "z" }] });
	assert.deepEqual(s.learn.map((x) => x.name), ["x", "y"]);
	assert.equal(s.holdout.name, "z");
});

test("pareto: a candidate must not lose on any learning scenario and must win on one", () => {
	const current = { a: 0.4, b: 0.6 };
	assert.equal(pareto({ a: 0.8, b: 0.6 }, current), true);
	assert.equal(pareto({ a: 1, b: 0.4 }, current), false, "a win on a is paid for on b");
	assert.equal(pareto({ a: 0.4, b: 0.6 }, current), false, "no change is not a win");
});

test("parseCandidates: reads the JSON reply, drops duplicates, empties, and wordings missing a required phrase", () => {
	const reply = JSON.stringify({ candidates: ["run `node x.mjs` first", "run `node x.mjs` first", "", "no command here", 5] });
	assert.deepEqual(parseCandidates(reply, { keep: ["`node x.mjs`"], current: "old" }), ["run `node x.mjs` first"]);
	assert.deepEqual(parseCandidates("```json\n" + JSON.stringify({ candidates: ["a new one"] }) + "\n```", { keep: [], current: "old" }), ["a new one"]);
	assert.deepEqual(parseCandidates("not json", { keep: [], current: "old" }), []);
	assert.deepEqual(parseCandidates(JSON.stringify({ candidates: ["old"] }), { keep: [], current: "old" }), [], "the current wording is not a candidate");
});

test("--dry-run prints the plan and the most it can cost, and never calls claude", () => {
	const cases = caseDir();
	const fake = fakeClaude();
	const r = run([...base(cases), "--dry-run", "--call-budget", "0.2"], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /case toy/);
	assert.match(r.stdout, /learn on a, b; hold out holdout/);
	assert.match(r.stdout, /at most \$\d+\.\d\d/);
	assert.match(r.stdout, /stops at the budget of \$5/);
	assert.equal(fs.existsSync(path.join(path.dirname(fake.bin), "calls.jsonl")), false);
});

test("end to end: a better wording is found on the cheap model, confirmed on the other, and reported without touching any file in the repo", () => {
	const cases = caseDir();
	const fake = fakeClaude();
	const out = path.join(tempDir(), "out");
	const before = fs.readFileSync(path.join(cases, "toy.mjs"), "utf8");
	const r = run([...base(cases), "--out", out], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 0, r.stderr + r.stdout);
	const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
	assert.equal(report.verdict, "improved");
	assert.equal(report.best, "BETTER: do the thing and say pass");
	assert.equal(report.original, "do the thing");
	assert.equal(fs.readFileSync(path.join(out, "proposed.txt"), "utf8").trim(), report.best);
	// every scenario, the held-back one too, was run against the original, the best, and no guidance
	for (const s of ["a", "b", "holdout"]) {
		assert.equal(report.confirm[s].best.successes, 4, s);
		assert.equal(report.confirm[s].original.successes, 0, s);
		assert.equal(report.confirm[s].control.successes, 0, s);
	}
	assert.ok(report.confirm.holdout.p < 0.05);
	assert.equal(fs.readFileSync(path.join(cases, "toy.mjs"), "utf8"), before, "the case file is not edited");
	// the proposer ran on the strong model, the learning on the cheap one, the confirmation on the other; no tools anywhere
	const calls = fake.calls();
	const model = (c) => c.argv[c.argv.indexOf("--model") + 1];
	const proposers = calls.filter((c) => c.argv[1].includes("[stack-agent tune: propose]"));
	assert.equal(proposers.length, 1);
	assert.equal(model(proposers[0]), "opus");
	assert.ok(calls.filter((c) => model(c) === "haiku").length > 0);
	assert.ok(calls.filter((c) => model(c) === "sonnet").length >= 4 * 3 * 3);
	for (const c of calls.filter((c) => c.argv.includes("-p"))) assert.equal(c.argv[c.argv.indexOf("--tools") + 1], "");
});

test("a wording that wins the learning scenarios and loses the held-back one is not adopted", () => {
	const cases = caseDir();
	const fake = fakeClaude({ candidates: ["OVERFIT: say pass"] });
	const out = path.join(tempDir(), "out");
	const r = run([...base(cases), "--out", out], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 0, r.stderr + r.stdout);
	const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
	assert.equal(report.verdict, "not adopted");
	assert.match(report.reason, /held-back/);
	assert.equal(fs.existsSync(path.join(out, "proposed.txt")), false);
});

test("when no candidate beats the current wording on the cheap model, nothing is confirmed and nothing is proposed", () => {
	const cases = caseDir();
	const fake = fakeClaude({ candidates: ["just as bad as before"] });
	const out = path.join(tempDir(), "out");
	const r = run([...base(cases), "--out", out], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 0, r.stderr + r.stdout);
	const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
	assert.equal(report.verdict, "no better wording found");
	assert.equal(report.confirm, null);
	assert.ok(!fake.calls().some((c) => c.argv[c.argv.indexOf("--model") + 1] === "sonnet"), "the strong runs are not spent on a candidate that did not earn them");
});

test("a required phrase must survive: a candidate that drops it is thrown away before any call is spent on it", () => {
	const cases = caseDir({ keep: ["say pass"] });
	const fake = fakeClaude({ candidates: ["BETTER: do it", "BETTER: do the thing and say pass"] });
	const out = path.join(tempDir(), "out");
	const r = run([...base(cases), "--out", out], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 0, r.stderr + r.stdout);
	const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
	assert.equal(report.best, "BETTER: do the thing and say pass");
	assert.ok(!fake.calls().some((c) => c.argv[1].includes("guidance: BETTER: do it\n") || c.argv[1].endsWith("guidance: BETTER: do it")));
});

test("the budget is a hard stop: when it runs out the run reports itself unfinished and exits 1", () => {
	const cases = caseDir();
	const fake = fakeClaude({ replyCost: 0.4 });
	const out = path.join(tempDir(), "out");
	const r = run([...base(cases), "--out", out, "--budget", "1"], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 1, r.stderr + r.stdout);
	const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
	assert.equal(report.verdict, "unfinished");
	assert.match(report.reason, /budget/);
	assert.ok(report.spent <= 1.0001, `spent ${report.spent}`);
	assert.ok(fake.calls().length < 10);
});

test("a call that fails is tried again, so one bad answer does not lose a run of hundreds", () => {
	const cases = caseDir();
	const fake = fakeClaude({ failFirst: 2 });
	const out = path.join(tempDir(), "out");
	const r = run([...base(cases), "--out", out], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 0, r.stderr + r.stdout);
	const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
	assert.equal(report.verdict, "improved");
	assert.ok(report.calls >= fake.calls().length - 0, "the failed tries are counted and paid for");
});

test("when a call keeps failing the run stops unfinished, says what claude reported, and keeps what the last stage had counted", () => {
	const cases = caseDir();
	// the proposer and the cheap stage answer; the confirmation fails after a few calls
	const fake = fakeClaude({ failAfter: 30 });
	const out = path.join(tempDir(), "out");
	const r = run([...base(cases), "--out", out], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 1, r.stderr + r.stdout);
	const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
	assert.equal(report.verdict, "unfinished");
	assert.match(report.reason, /error_max_budget_usd/);
	assert.match(report.reason, /after 3 tries/);
	assert.ok(report.confirm, "the partial counts are kept");
	assert.ok(Object.values(report.confirm).some((t) => t.best.n > 0));
	assert.equal(fs.existsSync(path.join(out, "proposed.txt")), false);
});

test("unknown case, missing variant, and a case with one scenario are configuration errors (exit 2)", () => {
	const cases = caseDir();
	const fake = fakeClaude();
	for (const [args, message] of [
		[["--case", "nope", "--cases-dir", cases, "--budget", "1"], /no .*nope\.mjs/],
		[[...base(cases), "--variant", "missing"], /--variant: missing not in case toy/],
	]) {
		const r = run(args, { CLAUDE_BIN: fake.bin });
		assert.equal(r.status, 2, r.stdout + r.stderr);
		assert.match(r.stderr, message);
	}
	write(cases, "single.mjs", `export default { description: "d", better: "higher", variants: { control: null, current: "x" }, prompt: () => "p", score: () => 1 };\n`);
	const r = run(["--case", "single", "--cases-dir", cases, "--budget", "1"], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 2);
	assert.match(r.stderr, /at least two scenarios/);
});

test("ConfigError is what the option checks throw", () => {
	assert.throws(() => parseOptions(["--case", "x", "--budget", "0"]), ConfigError);
});

test("each call runs in a folder whose memory files are known, and the report says which (--work-dir, or one with none above it)", () => {
	const root = tempDir("stack-agent-work-");
	write(root, "CLAUDE.md", "# a playbook\n");
	const cases = caseDir();
	const fake = fakeClaude();
	const out = path.join(tempDir(), "out");
	const inner = path.join(root, "inner");
	const r = run([...base(cases), "--work-dir", inner, "--out", out], { CLAUDE_BIN: fake.bin });
	assert.equal(r.status, 0, r.stderr + r.stdout);
	assert.ok(fake.calls().every((c) => c.cwd.startsWith(inner)), "every call ran under --work-dir");
	const report = JSON.parse(fs.readFileSync(path.join(out, "report.json"), "utf8"));
	assert.equal(report.meta.workDir, inner);
	assert.ok(report.meta.memoryFilesRead.includes(path.join(root, "CLAUDE.md")));
	assert.match(r.stdout, /NOTE: every session also reads \d+ memory file\(s\) of yours/);
	const fake2 = fakeClaude();
	const out2 = path.join(tempDir(), "out");
	assert.equal(run([...base(cases), "--out", out2], { CLAUDE_BIN: fake2.bin }).status, 0);
	const report2 = JSON.parse(fs.readFileSync(path.join(out2, "report.json"), "utf8"));
	for (const c of fake2.calls()) assert.deepEqual(memoryFilesAbove(c.cwd), report2.meta.memoryFilesRead);
});
