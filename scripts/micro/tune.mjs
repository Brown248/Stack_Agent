#!/usr/bin/env node
// Looks for a better wording of one piece of guidance (a hook message, a skill paragraph), in two stages, and
// proposes it; it never edits a file. A strong model proposes rewrites. A cheap model tries the current wording and
// each rewrite on the case's learning scenarios, and a rewrite goes on only if it loses on none of them and wins on
// one. The best rewrite is then run against the original and against no guidance on the model people use, with many
// runs, on every scenario including the one held back, and it is proposed only when it is significantly better
// overall and the held-back scenario shows the win is not tied to the ones it was shaped on. Method after GEPA
// (reflective prompt evolution from failure text, arXiv 2507.19457) and MIPROv2 (cheap trials, then the top
// candidate re-scored on the full set); both found that training scores run well above held-out ones, which is why
// the last stage exists. With small samples a real gain is hard to see (docs/design-notes.md, "Headroom pilot"), so
// "no better wording found" is the usual honest answer. The scorer is a script the case ships, never a model.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { claudeEnv, claudeVersion, harnessVersion, resolveClaude, spawnClaude } from "../ab/lib.mjs";
import { ConfigError, parseArgs } from "../lib/files.mjs";
import { memoryNote, pickWorkBase } from "./work-dir.mjs";
import { CASES_DIR, CONTROL, checkCase, microArgs, toScore } from "./run.mjs";

const USAGE = `usage: node scripts/micro/tune.mjs --case NAME --budget USD [options]
  --case NAME           a case in scripts/micro/cases/ with at least two scenarios (required)
  --budget USD          the most to spend in all; the run stops and says so when it would pass it (required)
  --variant NAME        the wording to improve (default: current)
  --rounds N            propose-and-screen rounds (default 2)
  --candidates N        rewrites asked for in each round (default 4)
  --screen-runs N       calls per wording and learning scenario in the cheap stage (default 3)
  --confirm-runs N      calls per arm and scenario in the last stage, 4 to 100 (default 30)
  --propose-model M     writes the rewrites (default opus)
  --screen-model M      the cheap stage (default haiku)
  --confirm-model M     the last stage; use the model people run (default sonnet)
  --call-budget USD     --max-budget-usd for each call (default 0.3)
  --cases-dir DIR       read the case from this folder (default scripts/micro/cases)
  --out DIR             results folder (default: a new folder in the system temp folder)
  --work-dir DIR        where each call's empty folder is made. Default: the first of the system temp folder, C:/Users/Public,
                        C:/ProgramData, /tmp with no CLAUDE.md above it (claude reads those whatever --setting-sources says)
  --dry-run             print the plan and the most it can cost; never calls claude
  --json                print the report as JSON
writes report.json, and proposed.txt when a wording is proposed. Nothing in the repository is changed.
exit codes: 0 finished (whatever the verdict), 1 ran out of budget or a call failed, 2 usage error`;

const int = (value, name, min, max, fallback) => {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max) throw new ConfigError(`${name} must be a whole number from ${min} to ${max}`);
	return n;
};

export function parseOptions(argv) {
	const args = parseArgs(argv, {
		flags: ["dry-run", "json", "help"],
		options: ["case", "cases-dir", "variant", "budget", "call-budget", "rounds", "candidates", "screen-runs", "confirm-runs", "propose-model", "screen-model", "confirm-model", "work-dir", "out"],
	});
	if (args.help) return { help: true };
	if (!args.case) throw new ConfigError("--case is required");
	const budget = Number(args.budget);
	if (!(budget > 0)) throw new ConfigError("--budget must be a positive number of dollars");
	const callBudget = args["call-budget"] === undefined ? 0.3 : Number(args["call-budget"]);
	if (!(callBudget > 0)) throw new ConfigError("--call-budget must be a positive number of dollars");
	return {
		caseName: args.case,
		casesDir: path.resolve(args["cases-dir"] ?? CASES_DIR),
		variant: args.variant ?? "current",
		budget,
		callBudget,
		rounds: int(args.rounds, "--rounds", 1, 10, 2),
		candidates: int(args.candidates, "--candidates", 2, 10, 4),
		screenRuns: int(args["screen-runs"], "--screen-runs", 1, 20, 3),
		confirmRuns: int(args["confirm-runs"], "--confirm-runs", 4, 100, 30),
		proposeModel: args["propose-model"] ?? "opus",
		screenModel: args["screen-model"] ?? "haiku",
		confirmModel: args["confirm-model"] ?? "sonnet",
		workDir: args["work-dir"] ?? null,
		out: path.resolve(args.out ?? path.join(os.tmpdir(), `stack-agent-tune-${args.case}-${Date.now()}`)),
		dryRun: Boolean(args["dry-run"]),
		json: Boolean(args.json),
	};
}

// P(at least `a` of the na runs in arm A pass | the same pass rate in both arms), given a + b passes in all: the
// one-sided Fisher exact test, as the decision to adopt a wording is only about being better
export function fisherOneSided(a, na, b, nb) {
	const K = a + b;
	const N = na + nb;
	if (N === 0) return 1;
	const logFact = [0];
	for (let i = 1; i <= N; i++) logFact[i] = logFact[i - 1] + Math.log(i);
	const logC = (n, k) => logFact[n] - logFact[k] - logFact[n - k];
	let p = 0;
	for (let x = a; x <= Math.min(na, K); x++) {
		if (K - x > nb) continue;
		p += Math.exp(logC(K, x) + logC(N - K, na - x) - logC(N, na));
	}
	return Math.min(1, p);
}

// every scenario but the last is learned from; the last is held back and only looked at in the last stage
export function checkScenarios(name, mod) {
	const list = mod?.scenarios;
	if (!Array.isArray(list) || list.length < 2)
		throw new ConfigError(`case ${name}: tuning needs at least two scenarios (scenarios: [{ name, prompt(guidance), score(text) }, ...]; the last one is held back), so one scenario cannot decide`);
	const names = new Set();
	for (const s of list) {
		if (typeof s?.name !== "string" || typeof s.prompt !== "function" || typeof s.score !== "function") throw new ConfigError(`case ${name}: every scenario needs a name, prompt(guidance), and score(text)`);
		if (names.has(s.name)) throw new ConfigError(`case ${name}: two scenarios are named ${s.name}`);
		names.add(s.name);
	}
	return { learn: list.slice(0, -1), holdout: list.at(-1) };
}

// not worse on any learning scenario, and better on at least one
export function pareto(candidate, current, eps = 1e-9) {
	const keys = Object.keys(current);
	return keys.every((k) => (candidate[k] ?? 0) >= current[k] - eps) && keys.some((k) => (candidate[k] ?? 0) > current[k] + eps);
}

// the proposer's reply: {"candidates": [...]}, bare or in a code fence; only new, non-empty wordings that keep every required phrase
export function parseCandidates(text, { keep = [], current }) {
	const raw = String(text ?? "");
	let parsed = null;
	for (const attempt of [raw.trim(), /```(?:json)?\s*([\s\S]*?)```/.exec(raw)?.[1], /\{[\s\S]*\}/.exec(raw)?.[0]]) {
		if (!attempt) continue;
		try {
			parsed = JSON.parse(attempt);
			break;
		} catch {}
	}
	const list = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
	const out = [];
	for (const item of list) {
		if (typeof item !== "string") continue;
		const text = item.trim();
		if (!text || text === String(current).trim() || out.includes(text) || !keep.every((k) => text.includes(k))) continue;
		out.push(text);
	}
	return out;
}

export function proposerPrompt({ c, current, failures, count, keep }) {
	return [
		"[stack-agent tune: propose]",
		"You improve a short piece of guidance that Stack Agent shows a coding agent at the moment it matters (a hook message or a paragraph of a skill). A script scores what the agent does after reading it; you cannot see the script.",
		`What the guidance is for: ${c.description}`,
		`The current wording:\n<<<\n${current}\n>>>`,
		failures.length
			? `Replies from an agent given this wording that the script scored as failures:\n${failures.map((f, i) => `--- failure ${i + 1} (scenario ${f.scenario}) ---\n${f.text.slice(0, 1200)}`).join("\n")}`
			: "No failing replies were kept; improve the wording on what you can see in it.",
		keep.length ? `Every wording must contain these exact phrases, unchanged: ${keep.map((k) => JSON.stringify(k)).join(", ")}.` : null,
		`Write ${count} different rewrites. Say what to do rather than what not to do, keep commands, flags, and file names exactly as they are, and keep each rewrite under one and a half times the length of the current wording. Do not mention the failures or this task inside a rewrite.`,
		'Reply with only JSON: {"candidates": ["rewrite 1", "rewrite 2", ...]}',
	]
		.filter(Boolean)
		.join("\n\n");
}

class BudgetExceeded extends Error {}
class CallFailed extends Error {}

export function newLedger(budget, callBudget, base = os.tmpdir()) {
	const ledger = { budget, callBudget, spent: 0, calls: 0, biggest: 0, base };
	// before a call: stop if it could take the total past the budget, judging by the most expensive call so far
	ledger.check = () => {
		const expected = ledger.biggest || Math.min(callBudget, budget);
		if (ledger.spent + expected > budget + 1e-12) throw new BudgetExceeded(`the budget of $${budget} would be passed (spent $${ledger.spent.toFixed(4)} in ${ledger.calls} calls)`);
	};
	ledger.add = (cost) => {
		ledger.calls++;
		if (typeof cost === "number") {
			ledger.spent += cost;
			ledger.biggest = Math.max(ledger.biggest, cost);
		}
	};
	return ledger;
}

// One call; a call that fails is tried again up to TRIES times in all (a run of hundreds of calls should not be lost to
// one that did not answer: the first live run stopped at call 85 of about 240 on "error_max_budget_usd" for a call that
// normally costs two cents). Every try is paid for and counted, and the last error says what claude reported.
const TRIES = 3;
function ask({ claude, env, ledger, prompt, model }) {
	let failure = "";
	for (let attempt = 1; attempt <= TRIES; attempt++) {
		ledger.check();
		const cwd = fs.mkdtempSync(path.join(ledger.base, "stack-agent-tune-call-"));
		try {
			const cap = Math.min(ledger.callBudget, Math.max(ledger.budget - ledger.spent, 0.001));
			const r = spawnClaude(claude, microArgs({ prompt, model, budget: cap }), cwd, env);
			if (r.error) {
				failure = r.error.message;
				continue;
			}
			let out;
			try {
				out = JSON.parse(r.stdout);
			} catch {
				failure = `claude exited ${r.status} without JSON: ${(r.stderr || r.stdout).trim().slice(0, 300)}`;
				continue;
			}
			ledger.add(typeof out.total_cost_usd === "number" ? out.total_cost_usd : null);
			if (out.is_error || typeof out.result !== "string") {
				const cost = typeof out.total_cost_usd === "number" ? ` (cost $${out.total_cost_usd}, cap $${cap.toFixed(3)}, ${model})` : "";
				failure = `claude reported an error: ${String(out.result ?? out.subtype ?? "no result").slice(0, 300)}${out.subtype ? ` [${out.subtype}]` : ""}${cost}`;
				continue;
			}
			return out.result;
		} finally {
			fs.rmSync(cwd, { recursive: true, force: true });
		}
	}
	throw new CallFailed(`${failure}, after ${TRIES} tries`);
}

const passed = (scenario, text) => toScore(scenario.score(text)) >= 0.5;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function planText(o, c, scenarios) {
	const learnCalls = (1 + o.candidates * o.rounds) * scenarios.learn.length * o.screenRuns;
	const proposeCalls = o.rounds;
	const confirmCalls = 3 * (scenarios.learn.length + 1) * o.confirmRuns;
	const calls = proposeCalls + learnCalls + confirmCalls;
	return [
		`case ${c.name}: tune ${o.variant}. learn on ${scenarios.learn.map((s) => s.name).join(", ")}; hold out ${scenarios.holdout.name}`,
		`  ${proposeCalls} calls to ${o.proposeModel} to propose, up to ${learnCalls} on ${o.screenModel} to screen, up to ${confirmCalls} on ${o.confirmModel} to confirm (original, best, and no guidance)`,
		`  ${calls} calls, at most $${(calls * o.callBudget).toFixed(2)} if every one hit its cap of $${o.callBudget}; stops at the budget of $${o.budget}`,
	].join("\n");
}

export async function tune(o, c, scenarios, { claude, env, log }) {
	const ledger = newLedger(o.budget, o.callBudget, o.workBase);
	const original = String(c.variants[o.variant]).trim();
	const keep = Array.isArray(c.keep) ? c.keep : [];
	const report = { case: c.name, variant: o.variant, original, best: original, verdict: "unfinished", reason: "", rounds: [], confirm: null, spent: 0, calls: 0 };
	const finish = (verdict, reason) => Object.assign(report, { verdict, reason, spent: Number(ledger.spent.toFixed(6)), calls: ledger.calls });
	const learnNames = scenarios.learn.map((s) => s.name);
	try {
		// stage 1: propose, screen
		let best = original;
		let bestMeans = null;
		let failures = [];
		const tryWording = (text, runs) => {
			const scores = Object.fromEntries(learnNames.map((n) => [n, []]));
			const bad = [];
			for (let n = 0; n < runs; n++)
				for (const s of scenarios.learn) {
					const reply = ask({ claude, env, ledger, prompt: s.prompt(text), model: o.screenModel });
					const ok = passed(s, reply);
					scores[s.name].push(ok ? 1 : 0);
					if (!ok) bad.push({ scenario: s.name, text: reply });
				}
			return { means: Object.fromEntries(learnNames.map((n) => [n, mean(scores[n])])), failures: bad };
		};
		({ means: bestMeans, failures } = tryWording(best, o.screenRuns));
		for (let round = 1; round <= o.rounds; round++) {
			const proposed = ask({ claude, env, ledger, prompt: proposerPrompt({ c, current: best, failures: failures.slice(0, 3), count: o.candidates, keep }), model: o.proposeModel });
			const candidates = parseCandidates(proposed, { keep, current: best }).slice(0, o.candidates);
			const row = { round, current: best, currentMeans: bestMeans, candidates: [] };
			report.rounds.push(row);
			log(`round ${round}: ${candidates.length} candidates`);
			let winner = null;
			for (const text of candidates) {
				const { means, failures: bad } = tryWording(text, o.screenRuns);
				const wins = pareto(means, bestMeans);
				row.candidates.push({ text, means, pareto: wins });
				log(`  ${wins ? "+" : "-"} ${learnNames.map((n) => `${n} ${means[n].toFixed(2)}`).join(" ")}  ${text.slice(0, 70).replace(/\s+/g, " ")}`);
				if (wins && (!winner || mean(Object.values(means)) > mean(Object.values(winner.means)))) winner = { text, means, bad };
			}
			if (!winner) break;
			best = winner.text;
			bestMeans = winner.means;
			failures = winner.bad;
		}
		report.best = best;
		if (best === original) return finish("no better wording found", `no rewrite lost on none of ${learnNames.join(", ")} and won on one, so nothing was run on ${o.confirmModel}`);

		// stage 2: the full set on the model people use
		const all = [...scenarios.learn, scenarios.holdout];
		const arms = { original, best, control: null };
		const tally = Object.fromEntries(all.map((s) => [s.name, Object.fromEntries(Object.keys(arms).map((a) => [a, { successes: 0, n: 0 }]))]));
		// kept in the report as it fills, so a run that stops partway still shows what it had counted
		report.confirm = tally;
		for (let n = 0; n < o.confirmRuns; n++)
			for (const s of all)
				for (const [arm, text] of Object.entries(arms)) {
					const ok = passed(s, ask({ claude, env, ledger, prompt: s.prompt(text), model: o.confirmModel }));
					tally[s.name][arm].n++;
					if (ok) tally[s.name][arm].successes++;
				}
		for (const s of all) tally[s.name].p = fisherOneSided(tally[s.name].best.successes, tally[s.name].best.n, tally[s.name].original.successes, tally[s.name].original.n);
		report.confirm = tally;
		const pool = (arm) => all.reduce((acc, s) => ({ successes: acc.successes + tally[s.name][arm].successes, n: acc.n + tally[s.name][arm].n }), { successes: 0, n: 0 });
		const b = pool("best");
		const orig = pool("original");
		report.pooled = { best: b, original: orig, p: fisherOneSided(b.successes, b.n, orig.successes, orig.n) };
		const h = tally[scenarios.holdout.name];
		const rate = (x) => x.successes / x.n;
		const carried = rate(h.best) >= rate(h.original) && (h.best.successes > h.original.successes || rate(h.original) >= 0.9);
		if (report.pooled.p >= 0.05) return finish("not adopted", `the best rewrite is not significantly better than the original over all scenarios (${b.successes}/${b.n} against ${orig.successes}/${orig.n}, one-sided p ${report.pooled.p.toFixed(3)})`);
		if (!carried) return finish("not adopted", `the best rewrite wins on the learning scenarios but not on the held-back one (${scenarios.holdout.name}: ${h.best.successes}/${h.best.n} against ${h.original.successes}/${h.original.n}), so the win may be tied to the scenarios it was shaped on`);
		return finish("improved", `${b.successes}/${b.n} against ${orig.successes}/${orig.n} over all scenarios on ${o.confirmModel} (one-sided p ${report.pooled.p.toFixed(4)}); the held-back scenario ${scenarios.holdout.name} went ${h.original.successes}/${h.original.n} to ${h.best.successes}/${h.best.n}`);
	} catch (err) {
		if (err instanceof BudgetExceeded) return finish("unfinished", err.message);
		if (err instanceof CallFailed) return finish("unfinished", `a call failed: ${err.message}`);
		throw err;
	}
}

export function summary(report, o) {
	const lines = [`${report.case}: ${report.verdict}. ${report.reason}`, `spent $${report.spent.toFixed(4)} in ${report.calls} calls`];
	if (report.confirm) {
		lines.push(`confirm on ${o.confirmModel}, ${o.confirmRuns} runs per arm (passes: original / best / no guidance)`);
		for (const [name, t] of Object.entries(report.confirm)) lines.push(`  ${name.padEnd(14)} ${t.original.successes}/${t.original.n}  ${t.best.successes}/${t.best.n}  ${t.control.successes}/${t.control.n}   p ${t.p.toFixed(3)}`);
	}
	if (report.verdict === "improved") lines.push("", "proposed wording (also in proposed.txt; copy it into the source by hand):", report.best);
	return lines.join("\n");
}

export async function main(argv) {
	const o = parseOptions(argv);
	if (o.help) {
		console.log(USAGE);
		return 0;
	}
	const file = path.join(o.casesDir, `${o.caseName}.mjs`);
	if (!/^[\w-]+$/.test(o.caseName)) throw new ConfigError(`--case: ${o.caseName} is not a case name`);
	if (!fs.existsSync(file)) throw new ConfigError(`--case: no ${file}`);
	const c = checkCase(o.caseName, (await import(pathToFileURL(file).href)).default);
	if (c.better !== "higher") throw new ConfigError(`case ${c.name}: tuning is written for scores where higher is better`);
	if (typeof c.variants[o.variant] !== "string" || o.variant === CONTROL) throw new ConfigError(`--variant: ${o.variant} not in case ${c.name} (${Object.keys(c.variants).join(", ")})`);
	const scenarios = checkScenarios(c.name, c);
	const log = o.json ? (s) => process.stderr.write(s + "\n") : (s) => console.log(s);
	log(planText(o, c, scenarios));
	if (o.dryRun) return 0;
	const claude = resolveClaude();
	const { env } = claudeEnv(true);
	let work;
	try {
		work = pickWorkBase({ requested: o.workDir });
	} catch (err) {
		throw new ConfigError(err.message);
	}
	o.workBase = work.base;
	fs.mkdirSync(o.out, { recursive: true });
	log(`out: ${o.out}`);
	if (memoryNote(work.memory)) log(memoryNote(work.memory));
	const report = await tune(o, c, scenarios, { claude, env, log });
	report.meta = { harnessVersion: harnessVersion(), claudeVersion: claudeVersion(claude), options: { ...o, out: undefined, casesDir: undefined }, workDir: work.base, memoryFilesRead: work.memory };
	fs.writeFileSync(path.join(o.out, "report.json"), JSON.stringify(report, null, 2));
	if (report.verdict === "improved") fs.writeFileSync(path.join(o.out, "proposed.txt"), report.best + "\n");
	if (o.json) console.log(JSON.stringify(report, null, 2));
	else log("\n" + summary(report, o));
	return report.verdict === "unfinished" ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
