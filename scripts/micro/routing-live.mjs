#!/usr/bin/env node
// Live routing check: does a real Claude Code session load the right skill for a request? skill-routing.mjs asks the
// same question in one text call (all requests at once, the listing pasted in); this one runs each request alone in a
// real `claude -p` session with the plugin loaded, as a person would, and reads which tool the model called first.
// A first call to the Skill tool is a load of that skill; any other first tool, or none, is "no skill". The run stops
// as soon as that first tool call arrives, so a request costs about one model turn, and a hook refuses every tool, so nothing the model asks for runs.
// The method is skill-creator's trigger evaluation in anthropics/skills (Apache 2.0): the real session, the early
// stop, several runs per request. The requests and what counts as right are skill-routing's.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_NAME, SUPERPOWERS, checkIsolation, claudeEnv, claudeVersion, parseTranscript, repoRoot, resolveClaude } from "../ab/lib.mjs";
import { scaffold } from "../../evals/scaffold.mjs";
import { ConfigError, parseArgs } from "../lib/files.mjs";
import { ITEMS, isRight, shippedSkills } from "./cases/skill-routing.mjs";
import { memoryNote, pickWorkBase } from "./work-dir.mjs";

const USAGE = `usage: node scripts/micro/routing-live.mjs --model MODEL --budget USD [options]
  --model MODEL        model passed to claude (required)
  --budget USD         --max-budget-usd for each call (required, no default)
  --runs N             sessions per request (1 to 20, default 3)
  --arms LIST          full (this plugin alone) and/or full+superpowers (beside obra/superpowers; needs --superpowers DIR)
                       comma separated, default full
  --superpowers DIR    an installed superpowers folder
  --per-skill N        requests per skill that should load it (default 2, of 4)
  --near-miss N        requests that should load none of ours (default 3, of 10)
  --only LIST          exactly these requests, by their number in skill-routing's list (for example 7,17,21); replaces
                       --per-skill and --near-miss
  --requests FILE      use the requests in this JSON file instead of skill-routing's list: an array of
                       { "request": "...", "ok": ["verify"] } where ok names the skills that are a right first load, or ["none"].
                       Numbered from 1 in file order. Replaces --per-skill, --near-miss, and --only
  --concurrency N      sessions at once (1 to 8, default 3)
  --project KIND       sample: each session starts in a Stack Agent project (examples/sample-backend, or sample-cli for a
                       request about a command line), as a person's does; bare: an empty folder (default sample)
  --timeout S          seconds to wait for a first tool call (default 120)
  --total-budget USD   stop starting sessions when this much would be passed (default: no limit besides --budget)
  --plugin DIR         plugin to test (default: this repo)
  --work-dir DIR       where the per-session folders go. Default: the first of the system temp folder, C:/Users/Public,
                       C:/ProgramData, /tmp with no CLAUDE.md above it (claude reads those whatever --setting-sources says)
  --out DIR            where to write results.json (default: a new folder in the system temp folder)
  --dry-run            print the requests and what the budgets add up to; never calls claude
  --json               print the results as JSON
cost: the budgets add up to requests x runs x arms x budget, printed before the first call. A budget is checked after a
  model turn, so one turn can pass it (about $0.05 was typical); --total-budget stops starting sessions. Each session runs in a temporary folder
  (a sample project, or empty with --project bare) with user settings and MCP servers off, a hook that refuses every tool, and is stopped at its first tool call.
exit codes: 0 done, 1 a session did not measure what its arm claims (a plugin did not load) or a call failed, 2 usage`;

// every skill of this plugin, including those only a person starts: loading any of them is loading one of ours
const OURS = new Set(shippedSkills().map((s) => s.name));
// the ones the model may start itself; a session must list them, or the plugin did not really load
const MODEL_SKILLS = shippedSkills().filter((s) => !s.hidden).map((s) => s.name);
const DENY_HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "deny-tools-hook.mjs");
export const bareName = (skill) => String(skill ?? "").replace(/^.*:/, "").trim();

// every group of requests (one per skill, and the near-misses) thinned to n, evenly spread, in the case's order
export function pickItems(items, { perSkill = 2, nearMiss = 3 } = {}) {
	const groups = new Map();
	items.forEach((item, index) => {
		const key = item.ok.includes("none") ? "none" : item.ok[0];
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push({ ...item, index: index + 1 });
	});
	const spread = (list, n) => (n >= list.length ? list : Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]));
	return [...groups].flatMap(([key, list]) => spread(list, key === "none" ? nearMiss : perSkill));
}

// what the model did first, from the stream-json events of a session: the skill it loaded (short name), the other tool
// it called, or nothing
export function firstChoice(events) {
	for (const o of events) {
		if (o?.type !== "assistant" || !Array.isArray(o.message?.content)) continue;
		for (const part of o.message.content) {
			if (part?.type !== "tool_use") continue;
			if (part.name === "Skill") {
				const skill = String(part.input?.skill ?? part.input?.command ?? "");
				return { answer: bareName(skill) || "unknown", tool: "Skill", skill };
			}
			return { answer: "none", tool: String(part.name), skill: null };
		}
	}
	return { answer: "none", tool: null, skill: null };
}

// right for a request: an acceptable skill of ours, or (for a request needing none of ours) no skill of ours
export const judge = (item, answer) => isRight(item, answer, { otherSkill: (a) => a !== "unknown" && !OURS.has(a) });

export function armPlugins(arm, { plugin, superpowers }) {
	if (arm === "full") return [plugin];
	if (arm === "full+superpowers") return [plugin, superpowers];
	throw new ConfigError(`--arms: ${arm} is not full or full+superpowers`);
}

// settings that put the refusing hook on every tool; forward slashes work in both Windows and POSIX shells
export const denySettings = () => JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `"${process.execPath.replaceAll("\\", "/")}" "${DENY_HOOK.replaceAll("\\", "/")}"`, timeout: 10 }] }] } });

export function liveArgs({ request, model, budget, plugins }) {
	return ["-p", request, "--model", model, "--max-budget-usd", String(budget), "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--setting-sources", "project,local", "--strict-mcp-config", "--settings", denySettings(), ...plugins.flatMap((d) => ["--plugin-dir", d])];
}

// a file of requests to try instead of the case's list; each names the skills that are a right first load
export function readRequests(file) {
	let list;
	try {
		list = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (err) {
		throw new ConfigError(`--requests: cannot read ${file}: ${err.message}`);
	}
	const allowed = new Set([...MODEL_SKILLS, "none"]);
	if (!Array.isArray(list) || !list.length) throw new ConfigError("--requests: the file must be a non-empty JSON array");
	list.forEach((item, i) => {
		const at = `--requests: item ${i + 1}`;
		if (typeof item?.request !== "string" || !item.request.trim()) throw new ConfigError(`${at} needs a request (text)`);
		if (!Array.isArray(item.ok) || !item.ok.length || item.ok.some((n) => !allowed.has(n))) throw new ConfigError(`${at}: ok must list skills from ${[...allowed].join(", ")}`);
		if (item.request.trimStart().startsWith("-")) throw new ConfigError(`${at}: a request cannot start with "-" (claude would read it as an option)`);
		if (item.ok.includes("none") && item.ok.length > 1) throw new ConfigError(`${at}: none cannot be listed with a skill`);
	});
	return list.map(({ request, ok }) => ({ request, ok }));
}

export function parseOptions(argv) {
	const args = parseArgs(argv, { flags: ["dry-run", "json", "help"], options: ["model", "budget", "runs", "arms", "superpowers", "per-skill", "near-miss", "only", "requests", "concurrency", "timeout", "total-budget", "plugin", "project", "work-dir", "out"] });
	if (args.help) return { help: true };
	if (!args.model) throw new ConfigError("--model is required");
	const budget = Number(args.budget);
	if (!(budget > 0)) throw new ConfigError("--budget must be a positive number of dollars");
	const whole = (name, value, lo, hi, fallback) => {
		if (value === undefined) return fallback;
		const n = Number(value);
		if (!Number.isInteger(n) || n < lo || n > hi) throw new ConfigError(`--${name} must be a whole number from ${lo} to ${hi}`);
		return n;
	};
	const arms = (args.arms ?? "full").split(",").map((a) => a.trim()).filter(Boolean);
	if (!arms.length || arms.some((a) => !["full", "full+superpowers"].includes(a)) || new Set(arms).size !== arms.length) throw new ConfigError("--arms must list full and/or full+superpowers once each");
	const superpowers = args.superpowers ? path.resolve(args.superpowers) : null;
	if (arms.includes("full+superpowers") && !(superpowers && fs.existsSync(superpowers))) throw new ConfigError("--arms full+superpowers needs --superpowers DIR, an installed superpowers folder");
	let only = null;
	if (args.only !== undefined) {
		only = String(args.only).split(",").map((n) => Number(n.trim()));
		if (!only.length || only.some((n) => !Number.isInteger(n) || n < 1 || n > ITEMS.length) || new Set(only).size !== only.length) throw new ConfigError(`--only must list distinct request numbers from 1 to ${ITEMS.length}`);
	}
	const requests = args.requests === undefined ? null : readRequests(path.resolve(args.requests));
	if (requests && only) throw new ConfigError("--requests and --only cannot be used together");
	const project = args.project ?? "sample";
	if (!["sample", "bare"].includes(project)) throw new ConfigError("--project must be sample or bare");
	const total = args["total-budget"] === undefined ? null : Number(args["total-budget"]);
	if (total !== null && !(total > 0)) throw new ConfigError("--total-budget must be a positive number of dollars");
	return {
		model: args.model,
		budget,
		runs: whole("runs", args.runs, 1, 20, 3),
		arms,
		superpowers,
		project,
		only,
		requests,
		perSkill: whole("per-skill", args["per-skill"], 1, 4, 2),
		nearMiss: whole("near-miss", args["near-miss"], 0, 10, 3),
		concurrency: whole("concurrency", args.concurrency, 1, 8, 3),
		timeout: whole("timeout", args.timeout, 5, 1800, 120),
		total,
		plugin: path.resolve(args.plugin ?? repoRoot),
		workDir: args["work-dir"] ?? null,
		out: path.resolve(args.out ?? path.join(os.tmpdir(), `stack-agent-routing-live-${Date.now()}`)),
		dryRun: Boolean(args["dry-run"]),
		json: Boolean(args.json),
	};
}

// Runs claude and settles at its first tool call, its result, its exit, or the timeout, whichever comes first, after
// stopping it and waiting for it to be gone (on Windows a process that is still exiting holds its folder, which then
// cannot be removed). `lines` are the stream-json lines read so far.
export function runSession({ claude, args, cwd, env, timeoutMs, exitWaitMs = 8000 }) {
	return new Promise((resolve) => {
		const lines = [];
		let buffer = "";
		let decided = null;
		let settled = false;
		let timedOut = false;
		let stderr = "";
		let exitTimer = null;
		const child = spawn(claude.command, [...claude.prefix, ...args], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
		const settle = () => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(exitTimer);
			resolve({ lines, stderr: stderr.slice(0, 500), timedOut, exited: child.exitCode !== null || child.signalCode !== null, ...decided });
		};
		// the answer is known: stop claude, and settle when it has exited or after exitWaitMs
		const finish = (extra = {}) => {
			if (decided) return;
			decided = extra;
			if (child.exitCode === null && child.signalCode === null) {
				child.kill();
				exitTimer = setTimeout(settle, exitWaitMs);
			} else settle();
		};
		const timer = setTimeout(() => {
			timedOut = true;
			finish();
		}, timeoutMs);
		child.on("error", (err) => {
			finish({ error: err.message });
			settle();
		});
		child.stderr.on("data", (d) => (stderr += d));
		child.stdout.on("data", (chunk) => {
			if (decided) return;
			buffer += chunk.toString("utf8");
			let nl;
			while ((nl = buffer.indexOf("\n")) >= 0) {
				const line = buffer.slice(0, nl).trim();
				buffer = buffer.slice(nl + 1);
				if (!line) continue;
				lines.push(line);
				let o;
				try {
					o = JSON.parse(line);
				} catch {
					continue;
				}
				if (o?.type === "result" || (o?.type === "assistant" && Array.isArray(o.message?.content) && o.message.content.some((p) => p?.type === "tool_use"))) return finish();
			}
		});
		child.on("close", () => {
			finish();
			settle();
		});
	});
}

// one session -> one row. Nothing here throws: a failure of any kind is a row with an error, so one bad session cannot
// lose the others' results. `scaffoldProject` is a parameter so a test can make the setup fail.
export async function measure({ claude, item, arm, run, opts, env, scaffoldProject = scaffold }) {
	const base = { arm, run, index: item.index, request: item.request, expected: item.ok };
	let cwd = null;
	try {
		cwd = fs.mkdtempSync(path.join(opts.workBase, "session-"));
		// the project a person would be in: the Python CLI for a request about a command line, the HTTP backend otherwise
		if (opts.project === "sample") scaffoldProject(cwd, repoRoot, item.ok.includes("feature-map") ? "sample-cli" : "sample-backend");
		const args = liveArgs({ request: item.request, model: opts.model, budget: opts.budget, plugins: armPlugins(arm, opts) });
		const t = Date.now();
		const s = await runSession({ claude, args, cwd, env, timeoutMs: opts.timeout * 1000 });
		const timed = { ...base, ms: Date.now() - t };
		if (s.error) return { ...timed, error: s.error };
		const parsed = parseTranscript(s.lines.join("\n"));
		const said = String(parsed.result?.result ?? s.stderr ?? "").trim().slice(0, 200);
		// no init event: claude never started a session (not logged in, a bad flag), which is not an isolation failure
		if (!parsed.init) return { ...timed, error: `claude did not start a session: ${said || "no output"}` };
		const iso = checkIsolation({ arm, parsed, isolate: true });
		if (!iso.ok) return { ...timed, invalid: iso.reasons };
		// a plugin that loads but shows none of its skills measured nothing about their descriptions
		const missing = MODEL_SKILLS.filter((n) => !iso.stackAgentSkills.includes(`${PLUGIN_NAME}:${n}`));
		if (missing.length) return { ...timed, invalid: [`the session does not list these skills of the plugin: ${missing.join(", ")}`] };
		const choice = firstChoice(parsed.events);
		const r = parsed.result;
		// a first tool call decides; without one, the session must have ended with a successful answer in text
		if (choice.tool === null) {
			if (!r) return { ...timed, error: s.timedOut ? `no first tool call or answer within ${opts.timeout} s` : `claude ended without a tool call or an answer: ${said || "no output"}` };
			if (r.is_error || r.subtype !== "success" || typeof r.result !== "string") return { ...timed, error: `claude did not answer (${r.subtype ?? "error"}): ${said}` };
		}
		return { ...timed, ...choice, right: judge(item, choice.answer), cost: r?.total_cost_usd ?? null };
	} catch (err) {
		return { ...base, error: `session failed: ${String(err?.message ?? err).slice(0, 200)}` };
	} finally {
		// the stopped process has exited by now; a leftover empty folder is harmless, so removing it never fails the run
		if (cwd) {
			try {
				fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
			} catch {}
		}
	}
}

export function summarize(rows, opts) {
	const lines = [];
	for (const arm of opts.arms) {
		const mine = rows.filter((r) => r.arm === arm);
		const ok = mine.filter((r) => typeof r.right === "boolean");
		const right = ok.filter((r) => r.right).length;
		lines.push(`${arm}: ${right}/${ok.length} sessions right${ok.length ? ` (${Math.round((100 * right) / ok.length)}%)` : ""}${mine.length - ok.length ? `, ${mine.length - ok.length} not measured` : ""}`);
		const byItem = new Map();
		for (const r of mine) {
			if (!byItem.has(r.index)) byItem.set(r.index, []);
			byItem.get(r.index).push(r);
		}
		for (const [index, list] of byItem) {
			const got = list.map((r) => (r.invalid ? "invalid" : r.error ? "error" : r.tool === "Skill" ? r.skill : r.tool ? `(${r.tool})` : "(no tool)"));
			const good = list.filter((r) => r.right).length;
			lines.push(`  ${good === list.length ? "ok  " : "MISS"} ${String(index).padStart(2)} want ${list[0].expected.join("/")}, got ${got.join(", ")} | ${list[0].request.slice(0, 60)}`);
		}
	}
	const cost = rows.map((r) => r.cost).filter((c) => typeof c === "number");
	lines.push(cost.length ? `cost of the ${cost.length} sessions that reported one: $${cost.reduce((a, b) => a + b, 0).toFixed(3)} (a session stopped at its first tool call may not report one)` : "no session reported a cost");
	return lines.join("\n");
}

export async function main(argv, { env = process.env } = {}) {
	const opts = parseOptions(argv);
	if (opts.help) return { code: 0, text: USAGE };
	const items = opts.requests ? opts.requests.map((item, i) => ({ ...item, index: i + 1 })) : opts.only ? ITEMS.map((item, i) => ({ ...item, index: i + 1 })).filter((item) => opts.only.includes(item.index)) : pickItems(ITEMS, { perSkill: opts.perSkill, nearMiss: opts.nearMiss });
	const calls = items.length * opts.runs * opts.arms.length;
	const head = `${items.length} requests x ${opts.runs} runs x ${opts.arms.length} arm(s) = ${calls} sessions, budgets add up to $${(calls * opts.budget).toFixed(2)}${opts.dryRun ? " (dry run)" : ""}`;
	if (opts.dryRun) return { code: 0, text: [head, ...items.map((i) => `  ${String(i.index).padStart(2)} want ${i.ok.join("/")}: ${i.request}`)].join("\n") };
	if (!fs.existsSync(path.join(opts.plugin, ".claude-plugin", "plugin.json"))) throw new ConfigError(`--plugin: ${opts.plugin} has no .claude-plugin/plugin.json`);
	const claude = resolveClaude(env);
	const version = claudeVersion(claude);
	const { env: childEnv } = claudeEnv(true, env);
	const log = opts.json ? (s) => process.stderr.write(`${s}\n`) : (s) => console.log(s);
	let work;
	try {
		work = pickWorkBase({ requested: opts.workDir });
	} catch (err) {
		throw new ConfigError(err.message);
	}
	opts.workBase = work.base;
	log(`${head}; claude ${version}, model ${opts.model}`);
	if (work.memory.length) log(memoryNote(work.memory));

	// every arm of a request once before its next run, so a drift during the run reaches every arm alike
	const jobs = [];
	for (let run = 1; run <= opts.runs; run++) for (const item of items) for (const arm of opts.arms) jobs.push({ item, arm, run });
	const rows = [];
	let next = 0;
	const micro = (usd) => Math.round(usd * 1e6);
	let committed = 0;
	let stopped = false;
	const worker = async () => {
		while (next < jobs.length) {
			if (opts.total !== null && committed + micro(opts.budget) > micro(opts.total)) {
				stopped = true;
				return;
			}
			const job = jobs[next++];
			committed += micro(opts.budget);
			rows.push(await measure({ claude, ...job, opts, env: childEnv }));
		}
	};
	await Promise.all(Array.from({ length: opts.concurrency }, worker));
	rows.sort((a, b) => a.run - b.run || a.index - b.index || a.arm.localeCompare(b.arm));
	fs.mkdirSync(opts.out, { recursive: true });
	const meta = { claude: version, model: opts.model, runs: opts.runs, arms: opts.arms, budgetPerCall: opts.budget, requests: items.map((i) => i.index), stoppedForBudget: stopped, workDir: work.base, memoryFilesRead: work.memory };
	fs.writeFileSync(path.join(opts.out, "results.json"), JSON.stringify({ meta, rows }, null, 2));
	const bad = rows.filter((r) => r.invalid || r.error);
	const notes = [
		...(stopped ? [`stopped: the next session would pass --total-budget $${opts.total}; ${rows.length} of ${jobs.length} sessions ran`] : []),
		...bad.filter((r) => r.invalid).slice(0, 3).map((r) => `INVALID (${r.arm}, request ${r.index}): ${r.invalid.join("; ")}`),
		...bad.filter((r) => r.error).slice(0, 3).map((r) => `ERROR (${r.arm}, request ${r.index}): ${r.error}`),
	];
	const text = opts.json ? JSON.stringify({ meta, rows }, null, 2) : [summarize(rows, opts), ...notes, `results: ${path.join(opts.out, "results.json")}`].join("\n");
	return { code: bad.length ? 1 : 0, text };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = await main(process.argv.slice(2));
		console.log(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`routing-live: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
