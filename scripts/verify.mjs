#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs, readJson, toPosix } from "./lib/files.mjs";

const USAGE = `usage: node verify.mjs [--root DIR] [--config FILE] [--skip-tests] [--skip-checks]
                      [--check NAME...] [--reuse] [--json]
exit codes: 0 all passed, 1 a step failed, 2 config or environment error`;

const CHECK_TYPES = ["http", "command"];

export function checkType(check) {
	return check.type ?? (check.command !== undefined ? "command" : "http");
}

export function loadVerifyConfig(file) {
	const config = readJson(file, "verify config");
	if (!config.test?.command && !config.checks?.length) throw new ConfigError("verify config needs test.command or checks[]");
	if (config.checks !== undefined && !Array.isArray(config.checks)) throw new ConfigError("checks must be an array");
	const names = new Set();
	for (const c of config.checks ?? []) {
		const where = `check ${JSON.stringify(c.name ?? "?")}`;
		if (!c.name) throw new ConfigError(`${where} needs a name`);
		if (names.has(c.name)) throw new ConfigError(`duplicate check name ${c.name}`);
		names.add(c.name);
		const type = checkType(c);
		if (!CHECK_TYPES.includes(type)) throw new ConfigError(`${where}: type must be one of ${CHECK_TYPES.join(", ")}`);
		if (type === "http") {
			if (!c.method || !c.path || typeof c.expectStatus !== "number") throw new ConfigError(`${where}: http checks need method, path, expectStatus`);
			if (!config.baseUrl) throw new ConfigError("verify config needs baseUrl when it has http checks");
		}
		if (type === "command") {
			if (!c.command || typeof c.command !== "string") throw new ConfigError(`${where}: command checks need a command string`);
			if (c.expectExit !== undefined && !Number.isInteger(c.expectExit)) throw new ConfigError(`${where}: expectExit must be an integer`);
			if (c.needsServer !== undefined && typeof c.needsServer !== "boolean") throw new ConfigError(`${where}: needsServer must be true or false`);
			if (c.expectOutputMatches !== undefined) {
				try {
					new RegExp(c.expectOutputMatches, c.expectOutputFlags ?? "m");
				} catch (err) {
					throw new ConfigError(`${where}: bad expectOutputMatches: ${err.message}`);
				}
			}
		}
	}
	return config;
}

export function isSubset(expected, actual) {
	if (expected === null || typeof expected !== "object") return Object.is(expected, actual);
	if (actual === null || typeof actual !== "object") return false;
	if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((e, i) => isSubset(e, actual[i]));
	return Object.entries(expected).every(([k, v]) => isSubset(v, actual[k]));
}

function childEnv(extra) {
	const env = { ...process.env, ...extra };
	delete env.NODE_TEST_CONTEXT;
	return env;
}

function tail(text, max = 4000) {
	return text.length > max ? "...\n" + text.slice(-max) : text;
}

function spawnTree(command, root, env) {
	return spawn(command, { cwd: root, shell: true, detached: process.platform !== "win32", env: childEnv(env), windowsHide: true });
}

export const OUTPUT_LIMIT = 8 * 1024 * 1024;

function collect(child, limit = OUTPUT_LIMIT) {
	let head = "";
	let rest = "";
	let truncated = false;
	const add = (d) => {
		const chunk = String(d);
		if (head.length < limit / 2) {
			const room = limit / 2 - head.length;
			head += chunk.slice(0, room);
			rest += chunk.slice(room);
		} else rest += chunk;
		if (rest.length > limit) {
			rest = rest.slice(-limit / 2);
			truncated = true;
		}
	};
	child.stdout.on("data", add);
	child.stderr.on("data", add);
	return () => ({ text: truncated ? head + "\n...[output truncated]...\n" + rest.slice(-limit / 2) : head + rest, truncated });
}

async function runCommand(root, { command, env, cwd, timeoutSec }, defaultTimeoutSec) {
	const started = Date.now();
	const child = spawnTree(command, cwd ? path.resolve(root, cwd) : root, env);
	const output = collect(child);
	let timedOut = false;
	const exitCode = await new Promise((resolve) => {
		const timer = setTimeout(async () => {
			timedOut = true;
			await stopProcess(child);
		}, (timeoutSec ?? defaultTimeoutSec) * 1000);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve(code);
		});
		child.on("error", () => {
			clearTimeout(timer);
			resolve(null);
		});
	});
	const { text, truncated } = output();
	return { exitCode, timedOut, output: text, truncated, durationMs: Date.now() - started };
}

async function runTests(root, test) {
	const r = await runCommand(root, test, 600);
	return { step: "tests", command: test.command, ok: r.exitCode === 0 && !r.timedOut, exitCode: r.exitCode, timedOut: r.timedOut, durationMs: r.durationMs, output: tail(r.output) };
}

async function runCommandCheck(root, check) {
	const r = await runCommand(root, check, 120);
	const expectExit = check.expectExit ?? 0;
	const problems = [];
	if (r.timedOut) problems.push(`timed out after ${check.timeoutSec ?? 120}s`);
	else if (r.exitCode !== expectExit) problems.push(`exit ${r.exitCode}, expected ${expectExit}`);
	if (check.expectOutputIncludes && !r.output.includes(check.expectOutputIncludes)) problems.push(`output does not include ${JSON.stringify(check.expectOutputIncludes)}`);
	const flags = check.expectOutputFlags ?? "m";
	if (check.expectOutputMatches && !new RegExp(check.expectOutputMatches, flags).test(r.output)) problems.push(`output does not match /${check.expectOutputMatches}/${flags}`);
	if (check.expectOutputExcludes && r.output.includes(check.expectOutputExcludes)) problems.push(`output includes ${JSON.stringify(check.expectOutputExcludes)}`);
	if (r.truncated && (check.expectOutputIncludes || check.expectOutputMatches || check.expectOutputExcludes))
		problems.push(`output was over ${OUTPUT_LIMIT / 1024 / 1024} MB, so the middle was dropped before matching; make the command quieter`);
	return { step: "check", type: "command", name: check.name, request: check.command, ok: problems.length === 0, exitCode: r.exitCode, timedOut: r.timedOut, truncated: r.truncated, problems, output: tail(r.output, 1000), durationMs: r.durationMs };
}

async function responds(url) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
		return res.status < 500;
	} catch {
		return false;
	}
}

function exited(child, ms) {
	if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(false), ms);
		child.once("exit", () => {
			clearTimeout(timer);
			resolve(true);
		});
	});
}

function signalTree(child, signal) {
	try {
		process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {}
	}
}

export async function stopProcess(child) {
	if (!child || child.pid === undefined) return;
	if (process.platform === "win32") {
		spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		await exited(child, 5000);
		return;
	}
	signalTree(child, "SIGTERM");
	if (!(await exited(child, 5000))) {
		signalTree(child, "SIGKILL");
		await exited(child, 2000);
	}
	signalTree(child, "SIGKILL");
}

async function startServer(root, server) {
	const log = [];
	const child = spawnTree(server.command, root, server.env);
	child.stdout.on("data", (d) => log.length < 200 && log.push(String(d)));
	child.stderr.on("data", (d) => log.length < 200 && log.push(String(d)));
	const deadline = Date.now() + (server.readyTimeoutSec ?? 30) * 1000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null) return { child, ok: false, reason: `server exited with code ${child.exitCode} before it was ready`, log };
		if (await responds(server.readyUrl)) return { child, ok: true, log };
		await delay(250);
	}
	return { child, ok: false, reason: `not ready at ${server.readyUrl} within ${server.readyTimeoutSec ?? 30}s`, log };
}

export function joinUrl(baseUrl, checkPath) {
	if (/^https?:\/\//.test(checkPath)) return checkPath;
	return baseUrl.replace(/\/+$/, "") + "/" + checkPath.replace(/^\/+/, "");
}

async function runCheck(baseUrl, check) {
	const started = Date.now();
	const headers = { ...(check.body !== undefined ? { "content-type": "application/json" } : {}), ...check.headers };
	const result = { step: "check", type: "http", name: check.name, request: `${check.method} ${check.path}`, expectStatus: check.expectStatus };
	try {
		const res = await fetch(joinUrl(baseUrl, check.path), {
			method: check.method,
			headers,
			body: check.body === undefined ? undefined : typeof check.body === "string" ? check.body : JSON.stringify(check.body),
			signal: AbortSignal.timeout((check.timeoutSec ?? 10) * 1000),
		});
		const text = await res.text();
		const problems = [];
		if (res.status !== check.expectStatus) problems.push(`status ${res.status}, expected ${check.expectStatus}`);
		if (check.expectBodyIncludes && !text.includes(check.expectBodyIncludes)) problems.push(`body does not include ${JSON.stringify(check.expectBodyIncludes)}`);
		if (check.expectJson !== undefined) {
			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch {
				problems.push("body is not JSON");
			}
			if (parsed !== undefined && !isSubset(check.expectJson, parsed)) problems.push(`JSON does not contain ${JSON.stringify(check.expectJson)}`);
		}
		return { ...result, ok: problems.length === 0, status: res.status, problems, body: tail(text, 1000), durationMs: Date.now() - started };
	} catch (err) {
		return { ...result, ok: false, problems: [`request failed: ${err.cause?.code ?? err.message}`], durationMs: Date.now() - started };
	}
}

function gitHead(root) {
	const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
	const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
	return r.status === 0 ? { head: r.stdout.trim(), dirty: dirty.stdout.trim().length > 0 } : null;
}

export async function runVerify({ root, config, skipTests, skipChecks, only, reuse }) {
	const steps = [];
	if (config.test?.command && !skipTests) steps.push(await runTests(root, config.test));

	const checks = (config.checks ?? []).filter((c) => !only?.length || only.includes(c.name));
	if (only?.length) {
		const unknown = only.filter((n) => !checks.some((c) => c.name === n));
		if (unknown.length) throw new ConfigError(`unknown check name(s): ${unknown.join(", ")}`);
	}
	if (checks.length && !skipChecks) {
		let server;
		try {
			const wantsServer = checks.some((c) => checkType(c) === "http" || c.needsServer === true);
			if (config.server && wantsServer) {
				const busy = await responds(config.server.readyUrl);
				if (busy && !reuse) {
					steps.push({ step: "server", ok: false, reason: `something already answers at ${config.server.readyUrl}. Stop it, change the port, or pass --reuse to drive it as is.` });
					return steps;
				}
				if (!busy) {
					server = await startServer(root, config.server);
					steps.push({ step: "server", command: config.server.command, ok: server.ok, reason: server.reason, log: tail(server.log.join(""), 2000) });
					if (!server.ok) return steps;
				}
			}
			for (const check of checks) steps.push(checkType(check) === "command" ? await runCommandCheck(root, check) : await runCheck(config.baseUrl, check));
		} finally {
			await stopProcess(server?.child);
		}
	}
	return steps;
}

function writeEvidence(root, config, steps, run) {
	const dir = path.resolve(root, config.evidenceDir ?? ".stack-agent/evidence");
	fs.mkdirSync(dir, { recursive: true });
	const at = new Date().toISOString();
	const record = { at, ok: steps.length > 0 && steps.every((s) => s.ok), full: run.full, flags: run.flags, git: gitHead(root), steps };
	const file = path.join(dir, `verify-${at.replace(/[:.]/g, "-")}.json`);
	const body = JSON.stringify(record, null, 2) + "\n";
	fs.writeFileSync(file, body);
	fs.writeFileSync(path.join(dir, "latest.json"), body);
	return { record, file: toPosix(path.relative(root, file)) };
}

function summarize(steps) {
	return steps.map((s) => {
		const mark = s.ok ? "PASS" : "FAIL";
		if (s.step === "tests") return `${mark} tests: ${s.command} (exit ${s.exitCode}${s.timedOut ? ", timed out" : ""})${s.ok ? "" : "\n" + s.output}`;
		if (s.step === "server") return `${mark} server: ${s.ok ? "ready" : s.reason}${s.ok || !s.log ? "" : "\n" + s.log}`;
		if (s.type === "command") return `${mark} check ${s.name}: ${s.request} -> exit ${s.exitCode}${s.ok ? "" : " (" + s.problems.join("; ") + ")\n" + s.output}`;
		return `${mark} check ${s.name}: ${s.request} -> ${s.status ?? "no response"}${s.ok ? "" : " (" + s.problems.join("; ") + ")"}`;
	});
}

async function main(argv) {
	const args = parseArgs(argv, { flags: ["skip-tests", "skip-checks", "reuse", "json", "help"], options: ["root", "config"], multi: ["check"] });
	if (args.help) return { code: 0, text: USAGE };
	const root = path.resolve(args.root ?? process.cwd());
	const config = loadVerifyConfig(path.resolve(root, args.config ?? ".stack-agent/verify.json"));
	const steps = await runVerify({ root, config, skipTests: args["skip-tests"], skipChecks: args["skip-checks"], only: args.check, reuse: args.reuse });
	if (steps.length === 0) throw new ConfigError("nothing ran: every step was skipped");
	const flags = argv.filter((a) => a.startsWith("--") && a !== "--root" && a !== "--config" && a !== "--json");
	const full = !args["skip-tests"] && !args["skip-checks"] && !args.check?.length && !args.reuse;
	const { record, file } = writeEvidence(root, config, steps, { full, flags });
	if (args.json) return { code: record.ok ? 0 : 1, text: JSON.stringify({ ...record, evidence: file }, null, 2) };
	const scope = full ? "" : ` (partial run: ${flags.join(" ")}; run with no flags before calling the change done)`;
	return { code: record.ok ? 0 : 1, text: [...summarize(steps), `verify: ${record.ok ? "ok" : "FAIL"}, evidence ${file}${scope}`].join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2)).then(
		({ code, text }) => {
			(code === 0 ? console.log : console.error)(text);
			process.exitCode = code;
		},
		(err) => {
			if (!(err instanceof ConfigError)) throw err;
			console.error(`verify: ${err.message}\n${USAGE}`);
			process.exitCode = 2;
		},
	);
}

export { main };
