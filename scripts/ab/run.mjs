#!/usr/bin/env node
// A/B harness: does the Stack Agent plugin change what a real Claude agent does?
// Same project, same prompt, different plugin arms, graded afterwards by scripts (never by the agent's own summary).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scaffold } from "../../evals/scaffold.mjs";
import { ConfigError, parseArgs } from "../lib/files.mjs";
import { ARMS, checkIsolation, claudeArgs, claudeEnv, claudeVersion, freePort, harnessVersion, hookFeedbackSummary, makeArmPlugin, parseTranscript, pluginGitInfo, repoRoot, resolveClaude, skillCalls, spawnClaude, usageOf } from "./lib.mjs";

const USAGE = `usage: node scripts/ab/run.mjs --task NAME [--task NAME ...] --model MODEL --budget USD [options]
  --task NAME     task module in scripts/ab/tasks/ (endpoint, validate, ...); repeatable; required
  --arms LIST     comma list from ${ARMS.join(", ")} (default full,none)
  --runs N        runs per task and arm (default 1)
  --model MODEL   model passed to claude (required)
  --budget USD    --max-budget-usd for each run (required, no default; a Sonnet run measured $0.25-0.45)
  --plugin DIR    plugin to test (default: this repo)
  --out DIR       output directory (default: a new folder under the system temp dir)
  --no-isolate    do not pass --setting-sources project,local --strict-mcp-config (default is isolated; --isolate is accepted)
  --dry-run       scaffold and grade an untouched copy of each project; never calls claude
  --disallowed-tools LIST  comma list passed to claude --disallowedTools, e.g. "Bash(node:*)" for an agent that cannot run Node
  --json          print the results as JSON instead of the summary table
exit codes: 0 done, 1 at least one run was invalid, 2 usage error`;

const here = path.dirname(fileURLToPath(import.meta.url));

export async function loadTask(name) {
	if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) throw new ConfigError(`bad task name "${name}"`);
	const file = path.join(here, "tasks", `${name}.mjs`);
	if (!fs.existsSync(file)) {
		const known = fs.readdirSync(path.join(here, "tasks")).filter((f) => f.endsWith(".mjs")).map((f) => f.slice(0, -4)).sort();
		throw new ConfigError(`unknown task "${name}" (available: ${known.join(", ")})`);
	}
	const task = await import(pathToFileURL(file).href);
	for (const key of ["name", "prompt", "probe", "grade"]) if (task[key] === undefined) throw new ConfigError(`task ${name} does not export ${key}`);
	return task;
}

export function parseOptions(argv) {
	const args = parseArgs(argv, { flags: ["dry-run", "json", "isolate", "no-isolate"], options: ["arms", "runs", "model", "budget", "plugin", "out", "disallowed-tools"], multi: ["task"] });
	if (args._.length) throw new ConfigError(`unexpected argument ${args._[0]}`);
	if (!args.task?.length) throw new ConfigError("--task is required");
	if (!args.model) throw new ConfigError("--model is required");
	if (args.budget === undefined) throw new ConfigError("--budget is required (USD per run)");
	const budget = Number(args.budget);
	if (!Number.isFinite(budget) || budget <= 0) throw new ConfigError(`--budget must be a positive number, got "${args.budget}"`);
	const arms = (args.arms ?? "full,none").split(",").map((a) => a.trim()).filter(Boolean);
	if (!arms.length) throw new ConfigError("--arms is empty");
	for (const a of arms) if (!ARMS.includes(a)) throw new ConfigError(`unknown arm "${a}" (use ${ARMS.join(", ")})`);
	const runs = Number(args.runs ?? 1);
	if (!Number.isInteger(runs) || runs < 1) throw new ConfigError(`--runs must be a positive integer, got "${args.runs}"`);
	const plugin = path.resolve(args.plugin ?? repoRoot);
	if (!fs.existsSync(path.join(plugin, ".claude-plugin", "plugin.json"))) throw new ConfigError(`--plugin ${plugin} has no .claude-plugin/plugin.json`);
	const out = path.resolve(args.out ?? fs.mkdtempSync(path.join(os.tmpdir(), "stack-agent-ab-")));
	if (out === plugin || out.startsWith(plugin + path.sep)) throw new ConfigError("--out must not be inside the plugin directory");
	const disallowedTools = (args["disallowed-tools"] ?? "").split(",").map((t) => t.trim()).filter(Boolean);
	return { tasks: [...new Set(args.task)], arms, runs, model: args.model, budget, plugin, out, isolate: !args["no-isolate"], dryRun: Boolean(args["dry-run"]), json: Boolean(args.json), disallowedTools };
}

async function runOne({ opts, task, arm, n, pluginDir, claude, meta }) {
	const id = `${task.name}-${arm}-${n}`;
	const dir = path.join(opts.out, "projects", id);
	const transcript = path.join(opts.out, "runs", `${id}.jsonl`);
	fs.mkdirSync(path.dirname(dir), { recursive: true });
	fs.mkdirSync(path.dirname(transcript), { recursive: true });
	scaffold(dir, opts.plugin, task.example, { port: await freePort() });
	// a bug-report task plants its bug in a commit of its own, so the session starts from code that has it
	await task.setup?.(dir);
	const row = { id, task: task.name, primary: task.primary ?? null, arm, n, ...meta, prompt: task.prompt, budget: opts.budget, model: opts.model, isolate: opts.isolate, disallowedTools: opts.disallowedTools, projectDir: dir, transcript: null, startedAt: new Date().toISOString() };
	if (opts.dryRun) {
		row.status = "dry-run";
		row.isolation = { ok: true, skipped: "dry-run", reasons: [] };
	} else {
		const args = claudeArgs({ prompt: task.prompt, model: opts.model, budget: opts.budget, pluginDir, isolate: opts.isolate, disallowedTools: opts.disallowedTools, extraTools: task.allowedTools ?? [], addDirs: task.addDirs?.() ?? [] });
		const { env, removed } = claudeEnv(opts.isolate);
		if (removed.length) row.envRemoved = removed;
		const r = spawnClaude(claude, args, dir, env);
		fs.writeFileSync(transcript, r.stdout ?? "");
		row.transcript = transcript;
		row.exit = r.status;
		row.timedOut = r.error?.code === "ETIMEDOUT";
		row.stderr = (r.stderr ?? "").slice(-500);
		const parsed = parseTranscript(r.stdout ?? "");
		row.usage = usageOf(parsed);
		row.hookFeedback = hookFeedbackSummary(parsed);
		row.skillCalls = skillCalls(parsed);
		row.isolation = checkIsolation({ arm, parsed, isolate: opts.isolate });
		row.status = row.isolation.ok ? "ok" : "invalid";
	}
	row.endedAt = new Date().toISOString();
	row.seconds = Math.round((Date.parse(row.endedAt) - Date.parse(row.startedAt)) / 1000);
	const g = await task.grade(dir);
	row.grade = g.checks;
	row.details = g.details;
	return row;
}

export function summarize(rows) {
	const out = [];
	const tasks = [...new Set(rows.map((r) => r.task))];
	for (const taskName of tasks) {
		const taskRows = rows.filter((r) => r.task === taskName);
		const graders = [...new Set(taskRows.flatMap((r) => Object.keys(r.grade ?? {})))];
		const header = ["arm", "runs", ...graders, "mean cost"];
		const lines = [header];
		for (const arm of [...new Set(taskRows.map((r) => r.arm))]) {
			const armRows = taskRows.filter((r) => r.arm === arm);
			const valid = armRows.filter((r) => r.status !== "invalid");
		// null means not applicable (e.g. no code change); such runs are left out of that grader's count
		const applicable = (k) => valid.filter((r) => r.grade?.[k] !== null && r.grade?.[k] !== undefined);
			const costs = valid.map((r) => r.usage?.cost).filter((c) => typeof c === "number");
			lines.push([arm, `${valid.length}/${armRows.length}`, ...graders.map((k) => `${applicable(k).filter((r) => r.grade?.[k] === true).length}/${applicable(k).length}`), costs.length ? `$${(costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(3)}` : "-"]);
		}
		const widths = header.map((_, i) => Math.max(...lines.map((l) => l[i].length)));
		out.push(`\n${taskName}`, ...lines.map((l) => "  " + l.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd()));
	}
	const invalid = rows.filter((r) => r.status === "invalid");
	if (invalid.length) {
		out.push("", `INVALID RUNS (${invalid.length}), excluded from the table above:`);
		for (const r of invalid) out.push(`  ${r.id}: ${r.isolation.reasons.join("; ")}`);
	}
	return out.join("\n");
}

export async function main(argv) {
	const opts = parseOptions(argv);
	const tasks = [];
	for (const t of opts.tasks) tasks.push(await loadTask(t));
	// a task can check its environment first (e.g. python for the CLI example), so a missing tool stops the run
	// instead of failing every arm the same way
	for (const t of tasks) await t.preflight?.();
	fs.mkdirSync(opts.out, { recursive: true });
	const claude = opts.dryRun ? null : resolveClaude();
	const git = pluginGitInfo(opts.plugin);
	const meta = {
		pluginDir: opts.plugin,
		pluginSha: git.sha,
		pluginDirty: git.dirty,
		harnessVersion: harnessVersion(),
		claudeVersion: opts.dryRun ? "dry-run (claude not called)" : claudeVersion(claude),
	};
	const log = opts.json ? (s) => process.stderr.write(s + "\n") : (s) => console.log(s);
	log(`out: ${opts.out}${opts.dryRun ? " (dry run)" : ""}`);
	const armPlugins = Object.fromEntries(opts.arms.map((a) => [a, makeArmPlugin(a, opts.plugin, opts.out)]));
	const rows = [];
	for (let n = 1; n <= opts.runs; n++) {
		for (const task of tasks) {
			// a task that only makes sense with the plugin (a skill run by slash command) names its arms
			for (const arm of opts.arms.filter((a) => !task.arms || task.arms.includes(a))) {
				const row = await runOne({ opts, task, arm, n, pluginDir: armPlugins[arm], claude, meta });
				rows.push(row);
				fs.writeFileSync(path.join(opts.out, "results.json"), JSON.stringify({ meta: { ...meta, model: opts.model, budget: opts.budget, isolate: opts.isolate, dryRun: opts.dryRun }, runs: rows }, null, 2));
				const checks = Object.entries(row.grade).map(([k, v]) => `${k} ${v}`).join(" ");
				log(`${row.id}: ${row.status}${row.usage ? ` $${row.usage.cost} ${row.usage.turns} turns ${row.seconds}s` : ""} | ${checks}`);
				if (row.status === "invalid") process.stderr.write(`INVALID RUN ${row.id}: ${row.isolation.reasons.join("; ")}\n`);
			}
		}
	}
	if (opts.json) console.log(JSON.stringify({ out: opts.out, runs: rows }, null, 2));
	else log(summarize(rows));
	return rows.some((r) => r.status === "invalid") ? 1 : 0;
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
