#!/usr/bin/env node
// Micro-tests: the cheap tier below the A/B harness. One claude call per sample, no tools, no project: a scenario
// plus one wording of the guidance under test (a hook message, a skill paragraph), scored by a script. Each case
// has a control with no guidance, so a wording is judged against doing nothing, and every variant runs several
// times, so one lucky answer does not decide it. After obra/superpowers' micro-test method (MIT), whose own
// measurement found a prohibition that scored worse than no guidance at all.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { claudeEnv, claudeVersion, harnessVersion, repoRoot, resolveClaude, spawnClaude } from "../ab/lib.mjs";
import { ConfigError, parseArgs } from "../lib/files.mjs";

const USAGE = `usage: node scripts/micro/run.mjs --case NAME --model MODEL --budget USD [options]
  --case NAME     a case in scripts/micro/cases/ (required)
  --model MODEL   model passed to claude (required)
  --budget USD    --max-budget-usd for each call (required, no default)
  --runs N        calls per variant (default 5)
  --variant NAME  run only these variants (repeatable; default all, and the control always runs)
  --out DIR       results folder (default: a new folder in the system temp folder)
  --dry-run       print each variant's prompt and the most it can cost; never calls claude
  --rescore FILE  score the replies saved in a results.json again with the case's current score(); never calls
                  claude, needs no --model or --budget (use it after fixing a scorer)
  --json          print the results as JSON
cost: at most runs x variants x budget, printed before the first call`;

export const CASES_DIR = path.join(repoRoot, "scripts", "micro", "cases");
export const CONTROL = "control";

export async function loadCase(name) {
	if (!/^[\w-]+$/.test(name)) throw new ConfigError(`--case: ${name} is not a case name`);
	const file = path.join(CASES_DIR, `${name}.mjs`);
	if (!fs.existsSync(file)) throw new ConfigError(`--case: no ${path.relative(repoRoot, file)}`);
	return checkCase(name, (await import(pathToFileURL(file).href)).default);
}

export function checkCase(name, mod) {
	const problems = [];
	if (typeof mod?.prompt !== "function") problems.push("prompt(guidance) must be a function");
	if (typeof mod?.score !== "function") problems.push("score(text) must be a function");
	if (!["higher", "lower"].includes(mod?.better)) problems.push('better must be "higher" or "lower"');
	if (!mod?.variants || mod.variants[CONTROL] !== null) problems.push(`variants must include ${CONTROL}: null (no guidance)`);
	else if (Object.entries(mod.variants).some(([k, v]) => k !== CONTROL && !(typeof v === "string" && v.trim()))) problems.push("every variant other than the control is non-empty text");
	if (problems.length) throw new ConfigError(`case ${name}: ${problems.join("; ")}`);
	return { name, ...mod };
}

export function parseOptions(argv) {
	const args = parseArgs(argv, { flags: ["dry-run", "json"], options: ["case", "model", "budget", "runs", "out", "rescore"], multi: ["variant"] });
	if (!args.case) throw new ConfigError("--case is required");
	if (args.rescore) return { caseName: args.case, rescore: path.resolve(args.rescore), json: Boolean(args.json) };
	if (!args.model) throw new ConfigError("--model is required");
	const budget = Number(args.budget);
	if (!(budget > 0)) throw new ConfigError("--budget must be a positive number of dollars");
	const runs = args.runs === undefined ? 5 : Number(args.runs);
	if (!Number.isInteger(runs) || runs < 1 || runs > 50) throw new ConfigError("--runs must be a whole number from 1 to 50");
	const out = path.resolve(args.out ?? path.join(os.tmpdir(), `stack-agent-micro-${args.case}-${Date.now()}`));
	return { caseName: args.case, model: args.model, budget, runs, variants: args.variant ?? null, out, dryRun: Boolean(args["dry-run"]), json: Boolean(args.json) };
}

// the control first, then the variants asked for, in the case's order
export function pickVariants(c, wanted) {
	const names = Object.keys(c.variants);
	const unknown = (wanted ?? []).filter((v) => !names.includes(v));
	if (unknown.length) throw new ConfigError(`--variant: ${unknown.join(", ")} not in case ${c.name} (${names.join(", ")})`);
	return [CONTROL, ...names.filter((n) => n !== CONTROL && (!wanted || wanted.includes(n)))];
}

// no tools, no session file, no user settings, plugins, or MCP servers: only the prompt reaches the model
export function microArgs({ prompt, model, budget }) {
	return ["-p", prompt, "--model", model, "--max-budget-usd", String(budget), "--output-format", "json", "--tools", "", "--no-session-persistence", "--setting-sources", "project,local", "--strict-mcp-config"];
}

// a score must be a finite number or a boolean (counted as 1 or 0); anything else is the case's bug, not the model's
export function toScore(value) {
	if (typeof value === "boolean") return value ? 1 : 0;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	throw new Error(`score() returned ${JSON.stringify(value)}; it must return a number or a boolean`);
}

export function callOnce({ claude, c, guidance, model, budget, env }) {
	const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "stack-agent-micro-call-"));
	try {
		const r = spawnClaude(claude, microArgs({ prompt: c.prompt(guidance), model, budget }), cwd, env);
		if (r.error) return { error: r.error.message };
		let out;
		try {
			out = JSON.parse(r.stdout);
		} catch {
			return { error: `claude exited ${r.status} without JSON: ${(r.stderr || r.stdout).trim().slice(0, 300)}` };
		}
		const cost = typeof out.total_cost_usd === "number" ? out.total_cost_usd : null;
		if (out.is_error || typeof out.result !== "string") return { error: `claude reported an error: ${String(out.result ?? out.subtype ?? "no result").slice(0, 300)}`, cost };
		return { text: out.result, cost, score: toScore(c.score(out.result)) };
	} finally {
		fs.rmSync(cwd, { recursive: true, force: true });
	}
}

export function summarize(c, rows) {
	const header = ["variant", "runs", "mean", "min", "max", "errors", "mean cost"];
	const lines = [header];
	for (const v of [...new Set(rows.map((r) => r.variant))]) {
		const mine = rows.filter((r) => r.variant === v);
		const scores = mine.map((r) => r.score).filter((s) => typeof s === "number");
		const costs = mine.map((r) => r.cost).filter((s) => typeof s === "number");
		const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
		lines.push([v, `${scores.length}/${mine.length}`, scores.length ? mean(scores).toFixed(2) : "-", scores.length ? String(Math.min(...scores)) : "-", scores.length ? String(Math.max(...scores)) : "-", String(mine.length - scores.length), costs.length ? `$${mean(costs).toFixed(4)}` : "-"]);
	}
	const widths = header.map((_, i) => Math.max(...lines.map((l) => l[i].length)));
	return [`${c.name} (${c.better} is better)`, ...lines.map((l) => "  " + l.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd())].join("\n");
}

// the saved replies scored again; a reply that was an error stays one
export function rescore(c, saved) {
	if (!Array.isArray(saved?.runs)) throw new ConfigError("--rescore: the file has no runs array");
	if (saved.meta?.case && saved.meta.case !== c.name) throw new ConfigError(`--rescore: the file is for case ${saved.meta.case}, not ${c.name}`);
	return saved.runs.map((r) => (typeof r.text === "string" ? { ...r, score: toScore(c.score(r.text)) } : r));
}

export async function main(argv) {
	const opts = parseOptions(argv);
	const c = await loadCase(opts.caseName);
	if (opts.rescore) {
		let saved;
		try {
			saved = JSON.parse(fs.readFileSync(opts.rescore, "utf8"));
		} catch (err) {
			throw new ConfigError(`--rescore: cannot read ${opts.rescore}: ${err.message}`);
		}
		const rows = rescore(c, saved);
		if (opts.json) console.log(JSON.stringify({ meta: saved.meta, runs: rows }, null, 2));
		else console.log(summarize(c, rows));
		return 0;
	}
	const variants = pickVariants(c, opts.variants);
	const log = opts.json ? (s) => process.stderr.write(s + "\n") : (s) => console.log(s);
	const most = opts.runs * variants.length * opts.budget;
	log(`case ${c.name}: ${variants.join(", ")} x ${opts.runs} runs = ${opts.runs * variants.length} calls, at most $${most.toFixed(2)}${opts.dryRun ? " (dry run)" : ""}`);
	if (opts.dryRun) {
		for (const v of variants) log(`\n--- ${v} ---\n${c.prompt(c.variants[v])}`);
		if (opts.json) console.log(JSON.stringify({ case: c.name, variants, calls: opts.runs * variants.length, maxCost: most, prompts: Object.fromEntries(variants.map((v) => [v, c.prompt(c.variants[v])])) }, null, 2));
		return 0;
	}
	const claude = resolveClaude();
	const meta = { case: c.name, model: opts.model, budget: opts.budget, runs: opts.runs, harnessVersion: harnessVersion(), claudeVersion: claudeVersion(claude) };
	const { env } = claudeEnv(true);
	fs.mkdirSync(opts.out, { recursive: true });
	log(`out: ${opts.out}`);
	const rows = [];
	// rounds instead of one variant after another, so a slow drift in the model or the service hits every variant alike
	for (let n = 1; n <= opts.runs; n++) {
		for (const v of variants) {
			const row = { variant: v, n, ...callOnce({ claude, c, guidance: c.variants[v], model: opts.model, budget: opts.budget, env }) };
			rows.push(row);
			fs.writeFileSync(path.join(opts.out, "results.json"), JSON.stringify({ meta, runs: rows }, null, 2));
			log(`${v} #${n}: ${row.error ? `error: ${row.error}` : `score ${row.score}`}${typeof row.cost === "number" ? ` $${row.cost.toFixed(4)}` : ""}`);
		}
	}
	if (opts.json) console.log(JSON.stringify({ out: opts.out, meta, runs: rows }, null, 2));
	else log("\n" + summarize(c, rows));
	return rows.some((r) => r.error) ? 1 : 0;
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
