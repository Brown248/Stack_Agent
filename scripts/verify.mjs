#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ConfigError, matchesAny, parseArgs, readJson, requireStringArray, toPosix } from "./lib/files.mjs";
import { FINGERPRINT_VERSION, SESSIONS_DIR, SKIP_FILE, changedFiles, codeFingerprint, fingerprintDiff, gitTop, ignoreList } from "./lib/fingerprint.mjs";

const USAGE = `usage: node verify.mjs [--root DIR] [--config FILE] [--skip-tests] [--skip-checks]
                      [--check NAME...] [--reuse] [--json] [--against GIT_REF | --no-against]
       node verify.mjs --check NAME... --repeat N   run each named check N times and report how many went red
       node verify.mjs --skip-checks --repeat N     run the test suite N times and report how many went red
       node verify.mjs --skip "REASON"   record why verification cannot run for the current code
       node verify.mjs --evidence-status  say whether the latest evidence is a full pass for the code as it is now (runs nothing)
exit codes: 0 all passed, 1 a step failed, 2 config or environment error`;
const MIN_SKIP_REASON = 15;
const MAX_REPEAT = 1000;

const CHECK_TYPES = ["http", "command"];

export function checkType(check) {
	return check.type ?? (check.command !== undefined || check.args !== undefined ? "command" : "http");
}

function runs(spec) {
	return spec?.command !== undefined || spec?.args !== undefined;
}

function checkRunSpec(spec, where, missing) {
	if (spec.command !== undefined && spec.args !== undefined) throw new ConfigError(`${where}: give command or args, not both`);
	if (spec.args === undefined) {
		if (!spec.command || typeof spec.command !== "string") throw new ConfigError(`${where}: ${missing}`);
	} else if (!Array.isArray(spec.args) || spec.args.length === 0 || !spec.args.every((a) => typeof a === "string") || !spec.args[0])
		throw new ConfigError(`${where}: args must be a non-empty array of strings`);
}

function shown(spec) {
	return spec.args ? spec.args.join(" ") : spec.command;
}

export function loadVerifyConfig(file) {
	const config = readJson(file, "verify config");
	if (!runs(config.test) && !config.checks?.length) throw new ConfigError("verify config needs test.command or checks[]");
	if (runs(config.test)) checkRunSpec(config.test, "test", "test needs a command string or an args array");
	if (config.server !== undefined) checkRunSpec(config.server, "server", "server needs a command string or an args array");
	if (config.checks !== undefined && !Array.isArray(config.checks)) throw new ConfigError("checks must be an array");
	if (config.against !== undefined && typeof config.against !== "boolean" && (typeof config.against !== "object" || config.against === null || Array.isArray(config.against)))
		throw new ConfigError("against must be true, false, or an object with keep, link, paths, setup, tmpDir, required");
	if (config.against && typeof config.against === "object") {
		const a = config.against;
		for (const key of ["keep", "link", "paths"]) requireStringArray(a[key], `against.${key}`, { optional: true });
		if (a.tmpDir !== undefined && (typeof a.tmpDir !== "string" || !a.tmpDir)) throw new ConfigError("against.tmpDir must be a folder path string");
		if (a.required !== undefined && typeof a.required !== "boolean") throw new ConfigError("against.required must be true or false");
		if (a.setup !== undefined) checkRunSpec(a.setup, "against.setup", "against.setup needs a command string or an args array");
	}
	requireStringArray(config.stopHookIgnore, "stopHookIgnore", { optional: true });
	if (config.stopHook !== undefined && !["block", "remind"].includes(config.stopHook)) throw new ConfigError('stopHook must be "block" or "remind"');
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
			if (c.followRedirects !== undefined && typeof c.followRedirects !== "boolean") throw new ConfigError(`${where}: followRedirects must be true or false`);
			if (c.expectHeaders !== undefined && (typeof c.expectHeaders !== "object" || c.expectHeaders === null || Array.isArray(c.expectHeaders) || !Object.values(c.expectHeaders).every((v) => typeof v === "string")))
				throw new ConfigError(`${where}: expectHeaders must map a header name to text its value must include, e.g. {"location": "/login"}`);
			// an invalid name would make the request code throw, which reads as "could not run" instead of a config mistake
			const badName = Object.keys(c.expectHeaders ?? {}).find((n) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(n));
			if (badName !== undefined) throw new ConfigError(`${where}: expectHeaders has an invalid header name ${JSON.stringify(badName)}`);
		}
		if (type === "command") {
			checkRunSpec(c, where, "command checks need a command string or an args array");
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

// every process tree verify started and has not seen close, so a verify that is interrupted can stop them
const live = new Set();

// `command` runs through the platform shell; `args` runs the program directly, so quoting is the same on every OS.
function spawnTree(spec, cwd, env) {
	const options = { cwd, detached: process.platform !== "win32", env: childEnv(env), windowsHide: true };
	const child = spec.args ? spawn(spec.args[0], spec.args.slice(1), { ...options, shell: false }) : spawn(spec.command, { ...options, shell: true });
	live.add(child);
	child.on("close", () => live.delete(child));
	child.on("error", () => live.delete(child));
	return child;
}

// how long to wait for the output after the command exits; a process it left running in the background can hold the
// output open forever. LINGER_MS is the quiet time that ends the wait, LINGER_MAX_MS the longest it can last.
const LINGER_MS = 1500;
const LINGER_MAX_MS = 10_000;

function startFailure(spec, err) {
	let hint = "";
	if (spec.args && process.platform === "win32" && ["ENOENT", "EINVAL"].includes(err.code))
		hint = ` Without a shell, Windows runs only .exe programs: npm, npx, and other .cmd or .bat scripts need "command" instead of "args", or call node with the script's path.`;
	else if (err.code === "ENOENT") hint = " Check that it is installed and on PATH.";
	return `could not start ${JSON.stringify(spec.args?.[0] ?? spec.command)}: ${err.code ?? err.message}.${hint}`;
}

export const OUTPUT_LIMIT = 8 * 1024 * 1024;

function collect(child, limit = OUTPUT_LIMIT) {
	let head = "";
	let rest = "";
	// every character seen, so output over the limit counts as truncated even while rest still holds all of its tail
	let total = 0;
	const add = (d) => {
		const chunk = String(d);
		total += chunk.length;
		if (head.length < limit / 2) {
			const room = limit / 2 - head.length;
			head += chunk.slice(0, room);
			rest += chunk.slice(room);
		} else rest += chunk;
		// keeps memory bounded; up to the limit nothing is dropped, since head + rest is then everything
		if (rest.length > limit) rest = rest.slice(-limit / 2);
	};
	child.stdout.on("data", add);
	child.stderr.on("data", add);
	return () => {
		const truncated = total > limit;
		return { text: truncated ? head + "\n...[output truncated]...\n" + rest.slice(-limit / 2) : head + rest, truncated };
	};
}

async function runCommand(root, spec, defaultTimeoutSec) {
	const { env, cwd, timeoutSec } = spec;
	const started = Date.now();
	let child;
	try {
		child = spawnTree(spec, cwd ? path.resolve(root, cwd) : root, env);
	} catch (err) {
		const startError = startFailure(spec, err);
		return { exitCode: null, timedOut: false, startError, output: startError, truncated: false, durationMs: Date.now() - started };
	}
	const output = collect(child);
	let timedOut = false;
	let lingering = false;
	let startError;
	const { exitCode, signal } = await new Promise((resolve) => {
		let done = false;
		let linger;
		const finish = (r) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			clearTimeout(linger);
			resolve(r);
		};
		const timer = setTimeout(async () => {
			timedOut = true;
			await stopProcess(child);
		}, (timeoutSec ?? defaultTimeoutSec) * 1000);
		// the exit code is known at exit; the output is complete at close, once every process holding it has let go
		child.on("exit", (code, sig) => {
			clearTimeout(timer);
			const stop = () => {
				lingering = true;
				// the command is done; what still holds its output is a process it left behind (POSIX: its process group)
				if (process.platform !== "win32") signalTree(child, "SIGKILL");
				child.stdout.destroy();
				child.stderr.destroy();
				finish({ exitCode: code, signal: sig });
			};
			// waiting ends after LINGER_MS with no new output, so a slow machine still delivers all of a fast command's
			// output; a leftover process that keeps printing is cut off after LINGER_MAX_MS
			const idle = () => {
				clearTimeout(linger);
				linger = setTimeout(stop, LINGER_MS);
			};
			idle();
			child.stdout.on("data", idle);
			child.stderr.on("data", idle);
			const cap = setTimeout(stop, LINGER_MAX_MS);
			child.once("close", () => {
				clearTimeout(cap);
				finish({ exitCode: code, signal: sig });
			});
		});
		child.on("error", (err) => {
			startError = startFailure(spec, err);
			finish({ exitCode: null, signal: null });
		});
	});
	const { text, truncated } = output();
	const note = lingering
		? `\n[verify: the command exited but a process it started kept running and holding its output; verify stopped waiting once its output went quiet${process.platform === "win32" ? " (on Windows that process is not stopped; end it yourself)" : " and stopped it"}]`
		: "";
	return { exitCode, signal, timedOut, startError, lingering, output: (startError ? [startError, text].filter(Boolean).join("\n") : text) + note, truncated, durationMs: Date.now() - started };
}

async function runTests(root, test) {
	const r = await runCommand(root, test, 600);
	return {
		step: "tests",
		command: shown(test),
		...(test.args && { args: test.args }),
		ok: r.exitCode === 0 && !r.timedOut,
		exitCode: r.exitCode,
		...(r.signal && { signal: r.signal }),
		...(r.startError && { inconclusive: true }),
		timedOut: r.timedOut,
		durationMs: r.durationMs,
		output: tail(r.output),
	};
}

async function runCommandCheck(root, check) {
	const r = await runCommand(root, check, 120);
	const expectExit = check.expectExit ?? 0;
	const problems = [];
	if (r.startError) problems.push(r.startError);
	else if (r.timedOut) problems.push(`timed out after ${check.timeoutSec ?? 120}s`);
	else if (r.signal) problems.push(`killed by ${r.signal}, expected exit ${expectExit}`);
	else if (r.exitCode !== expectExit) problems.push(`exit ${r.exitCode}, expected ${expectExit}`);
	if (check.expectOutputIncludes && !r.output.includes(check.expectOutputIncludes)) problems.push(`output does not include ${JSON.stringify(check.expectOutputIncludes)}`);
	const flags = check.expectOutputFlags ?? "m";
	if (check.expectOutputMatches && !new RegExp(check.expectOutputMatches, flags).test(r.output)) problems.push(`output does not match /${check.expectOutputMatches}/${flags}`);
	if (check.expectOutputExcludes && r.output.includes(check.expectOutputExcludes)) problems.push(`output includes ${JSON.stringify(check.expectOutputExcludes)}`);
	if (r.truncated && (check.expectOutputIncludes || check.expectOutputMatches || check.expectOutputExcludes))
		problems.push(`output was over ${OUTPUT_LIMIT / 1024 / 1024} MB, so the middle was dropped before matching; make the command quieter`);
	return { step: "check", type: "command", name: check.name, request: shown(check), ...(check.args && { args: check.args }), ok: problems.length === 0, ...((r.startError || r.timedOut) && { inconclusive: true }), exitCode: r.exitCode, timedOut: r.timedOut, truncated: r.truncated, problems, output: tail(r.output, 1000), durationMs: r.durationMs };
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
	let child;
	try {
		child = spawnTree(server, root, server.env);
	} catch (err) {
		return { child, ok: false, reason: startFailure(server, err), log };
	}
	let failed;
	child.on("error", (err) => (failed = startFailure(server, err)));
	child.stdout.on("data", (d) => log.length < 200 && log.push(String(d)));
	child.stderr.on("data", (d) => log.length < 200 && log.push(String(d)));
	const deadline = Date.now() + (server.readyTimeoutSec ?? 30) * 1000;
	while (Date.now() < deadline) {
		if (failed) return { child, ok: false, reason: failed, log };
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
			// false: the check sees the 3xx itself (an unauthenticated page that must send the user to /login)
			redirect: check.followRedirects === false ? "manual" : "follow",
			signal: AbortSignal.timeout((check.timeoutSec ?? 10) * 1000),
		});
		const text = await res.text();
		const problems = [];
		if (res.status !== check.expectStatus) problems.push(`status ${res.status}, expected ${check.expectStatus}`);
		for (const [name, want] of Object.entries(check.expectHeaders ?? {})) {
			const got = res.headers.get(name);
			if (got === null) problems.push(`no ${name} header`);
			else if (!got.includes(want)) problems.push(`${name} header ${JSON.stringify(got)} does not include ${JSON.stringify(want)}`);
		}
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
		return { ...result, ok: false, inconclusive: true, problems: [`request failed: ${err.cause?.code ?? err.message}`], durationMs: Date.now() - started };
	}
}

function gitHead(root) {
	const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
	const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
	return r.status === 0 ? { head: r.stdout.trim(), dirty: dirty.stdout.trim().length > 0 } : null;
}

// One step for N runs of a check: the red count, and each distinct problem with how often it came up.
// The server (when there is one) stays up across the runs, so state left by one run can reach the next.
async function repeatCheck(root, baseUrl, check, times) {
	const started = Date.now();
	const counts = new Map();
	let red = 0;
	let inconclusive = 0;
	let first;
	let last;
	for (let i = 0; i < times; i++) {
		last = checkType(check) === "command" ? await runCommandCheck(root, check) : await runCheck(baseUrl, check);
		if (last.ok) continue;
		red++;
		if (last.inconclusive) inconclusive++;
		first ??= { run: i + 1, ...(last.output !== undefined && { output: last.output }), ...(last.body !== undefined && { body: last.body }) };
		const text = last.problems.join("; ");
		counts.set(text, (counts.get(text) ?? 0) + 1);
	}
	const problems = [...counts].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count }));
	return { step: "repeat", type: last.type, name: check.name, request: last.request, runs: times, red, inconclusive, ok: red === 0, problems, ...(first && { firstRed: first }), durationMs: Date.now() - started };
}

// The test suite N times, for a repro written as a test: same shape as a repeated check.
async function repeatTests(root, test, times) {
	const started = Date.now();
	const counts = new Map();
	let red = 0;
	let inconclusive = 0;
	let first;
	for (let i = 0; i < times; i++) {
		const r = await runTests(root, test);
		if (r.ok) continue;
		red++;
		// a test killed by a signal (a crash) is a real red; only a run that never got to an answer is inconclusive
		if (r.timedOut || r.inconclusive) inconclusive++;
		first ??= { run: i + 1, output: r.output };
		const text = r.timedOut ? "timed out" : r.signal ? `killed by ${r.signal}` : r.inconclusive ? "could not start" : `exit ${r.exitCode}`;
		counts.set(text, (counts.get(text) ?? 0) + 1);
	}
	const problems = [...counts].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count }));
	return { step: "repeat", type: "tests", name: "tests", request: shown(test), runs: times, red, inconclusive, ok: red === 0, problems, ...(first && { firstRed: first }), durationMs: Date.now() - started };
}

export async function runVerify({ root, config, skipTests, skipChecks, only, reuse, repeat }) {
	const steps = [];
	if (repeat && skipChecks) {
		if (!runs(config.test)) throw new ConfigError("--skip-checks --repeat repeats the test suite, and verify.json has no test command");
		steps.push(await repeatTests(root, config.test, repeat));
		return steps;
	}
	if (runs(config.test) && !skipTests && !repeat) steps.push(await runTests(root, config.test));

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
					steps.push({ step: "server", command: shown(config.server), ok: server.ok, reason: server.reason, log: tail(server.log.join(""), 2000) });
					if (!server.ok) return steps;
				}
			}
			for (const check of checks)
				steps.push(
					repeat ? await repeatCheck(root, config.baseUrl, check, repeat) : checkType(check) === "command" ? await runCommandCheck(root, check) : await runCheck(config.baseUrl, check),
				);
		} finally {
			await stopProcess(server?.child);
		}
	}
	return steps;
}

export const fingerprintOptions = (config) => ({ ignore: ignoreList(config.stopHookIgnore), evidenceDir: config.evidenceDir ?? ".stack-agent/evidence" });

function writeEvidence(root, config, steps, run) {
	const dir = path.resolve(root, config.evidenceDir ?? ".stack-agent/evidence");
	fs.mkdirSync(dir, { recursive: true });
	const at = new Date().toISOString();
	const record = { at, ok: steps.length > 0 && steps.every((s) => s.ok), full: run.full, flags: run.flags, git: gitHead(root), fingerprint: run.fingerprint?.value ?? null, ...(run.fingerprint && { fingerprintVersion: FINGERPRINT_VERSION }), ignore: run.ignore, against: run.against };
	if (run.changedByRun?.length) record.changedByRun = run.changedByRun;
	record.steps = steps;
	const file = path.join(dir, `verify-${at.replace(/[:.]/g, "-")}.json`);
	const body = JSON.stringify(record, null, 2) + "\n";
	fs.writeFileSync(file, body);
	fs.writeFileSync(path.join(dir, "latest.json"), body);
	return { record, file: toPosix(path.relative(root, file)) };
}

// ---- against: the new checks must fail on the code before the change ---------------------------

// test files travel with the checks, so a check that runs a new test does not "fail before" only because the file is missing
export const AGAINST_KEEP = ["test/**", "tests/**", "__tests__/**", "**/*.test.*", "**/*.spec.*", "**/test_*.py", "**/*_test.py", "**/*_test.go"];
const AGAINST_PREFIX = "stack-agent-against-";
// a shell's own "command not found" is exit 127; the text alone could be the program rejecting a new subcommand
const MISSING_RE = /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find module|ModuleNotFoundError|No module named|is not recognized as an internal or external command/;
const gitRun = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const realpath = (p) => {
	try {
		return fs.realpathSync.native(p);
	} catch {
		return path.resolve(p);
	}
};
const canonical = (v) =>
	Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);

// what a check asserts; renaming a check or giving it more time does not make it new
function assertionKey(check) {
	const { name, timeoutSec, ...rest } = check;
	return canonical({ ...rest, type: checkType(check) });
}

// the HEAD this session started from (recorded by the SessionStart hook), so committing mid-task does not hide the change
function resolveAgainstRef(root, config, explicit) {
	const isCommit = (ref) => gitRun(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status === 0;
	if (explicit) {
		if (!isCommit(explicit)) throw new ConfigError(`--against: ${explicit} is not a commit in this repo`);
		return explicit;
	}
	if (!isCommit("HEAD")) return null;
	// the hooks keep session records at a fixed path, never under the configurable evidenceDir
	const dir = path.join(root, SESSIONS_DIR);
	// among sessions active in the last day whose start is behind HEAD, the earliest start: with two sessions in one
	// repo that compares with more history, never less, so neither session's checks are hidden by the other's commits
	let earliest = null;
	for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
		try {
			const file = path.join(dir, f);
			if (!f.endsWith(".json")) continue;
			// a start file is written once; the paired state file is rewritten on every stop, so take the newer of the two
			const pair = f.endsWith(".start.json") ? f.replace(/\.start\.json$/, ".json") : f.replace(/\.json$/, ".start.json");
			let active = fs.statSync(file).mtimeMs;
			try {
				active = Math.max(active, fs.statSync(path.join(dir, pair)).mtimeMs);
			} catch {}
			if (Date.now() - active > 24 * 3600_000) continue;
			const { head, at } = JSON.parse(fs.readFileSync(file, "utf8"));
			// a long-resumed session keeps a days-old start; comparing with it would count everyone's checks since then as new
			if (!(Date.now() - Date.parse(at) <= 3 * 24 * 3600_000)) continue;
			if (!head || !isCommit(head) || gitRun(root, ["merge-base", "--is-ancestor", head, "HEAD"]).status !== 0) continue;
			if (!earliest || String(at) < earliest.at) earliest = { head, at: String(at) };
		} catch {}
	}
	return earliest?.head ?? "HEAD";
}

function changedSince(root, ref) {
	const paths = new Set(gitRun(root, ["diff", "--name-only", "-z", "--relative", ref, "--", "."]).stdout.split("\0").filter(Boolean));
	for (const p of changedFiles(root) ?? []) paths.add(p);
	return [...paths];
}

function codeChangedSince(root, ref, config, keep) {
	const ignore = ignoreList(config.stopHookIgnore);
	return changedSince(root, ref).filter((p) => !p.startsWith(".stack-agent/") && !matchesAny(p, ignore) && !matchesAny(p, keep));
}

// test files (the against.keep globs) changed or added since the reference commit; a deleted test is not one
function testsChangedSince(root, ref, keep) {
	return changedSince(root, ref).filter((p) => matchesAny(p, keep) && fs.existsSync(path.join(root, p)));
}

// the names a failed import asked for: Node's "does not provide an export named 'x'", Python's "cannot import name 'x'"
const MISSING_NAME_RES = [/does not provide an export named '([^']+)'/g, /cannot import name '([^']+)'/g];
export function missingImportNames(output) {
	const names = new Set();
	for (const re of MISSING_NAME_RES) for (const m of String(output ?? "").matchAll(re)) names.add(m[1]);
	return [...names].slice(0, 5);
}

// a test run that dies on an import the old code lacks proves nothing about the change
const TEST_IMPORT_RE =/does not provide an export named|cannot import name|ImportError|Failed to import test module|SyntaxError: The requested module/;

function copyInto(fromRoot, toRoot, rel) {
	const to = path.join(toRoot, rel);
	fs.mkdirSync(path.dirname(to), { recursive: true });
	fs.copyFileSync(path.join(fromRoot, rel), to);
}

// links are removed before anything deletes the worktree, so nothing can follow a link into the real node_modules
function unlinkLinks(dir, depth = 0) {
	if (depth > 6) return;
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const p = path.join(dir, e.name);
		if (e.isSymbolicLink()) {
			try {
				fs.unlinkSync(p);
			} catch {
				try {
					fs.rmdirSync(p);
				} catch {}
			}
		} else if (e.isDirectory() && e.name !== ".git") unlinkLinks(p, depth + 1);
	}
}

export function removeWorktree(top, tmp, links) {
	for (const { at, target } of links) {
		try {
			if (fs.lstatSync(at).isSymbolicLink()) {
				try {
					fs.unlinkSync(at);
				} catch {
					fs.rmdirSync(at);
				}
			}
		} catch {}
		if (!fs.existsSync(target)) throw new Error(`verify: ${target} is missing after removing the link to it from the against worktree`);
	}
	unlinkLinks(tmp);
	const wt = path.join(tmp, "wt");
	if (fs.existsSync(wt)) gitRun(top, ["worktree", "remove", "--force", wt]);
	gitRun(top, ["worktree", "prune"]);
	fs.rmSync(tmp, { recursive: true, force: true });
}

// worktrees left by a crashed or killed run; only old ones, so a concurrent run is not disturbed
function cleanStaleWorktrees(top, base, prefix = AGAINST_PREFIX) {
	for (const name of fs.existsSync(base) ? fs.readdirSync(base) : []) {
		if (!name.startsWith(prefix)) continue;
		const tmp = path.join(base, name);
		try {
			if (Date.now() - fs.statSync(tmp).mtimeMs > 2 * 3600_000) removeWorktree(top, tmp, []);
		} catch {}
	}
}

// A detached checkout of ref in a temp folder (git hooks off during checkout), with dependency folders linked in
// from the project. Returns { top, tmp, wtRoot, links } or { error, top, tmp }; always pair with
// removeWorktree(top, tmp, links). Used by the against step and by sample-review for past commits.
// paths: folders relative to the project to check out, the project's own folder always included; leave it out to
// check out the whole repository. On a large monorepo the full checkout is the slow part (about 30 s at 100,000
// files, see design notes), and the project needs only its own folder and what it imports.
// The folders the against worktree links from the project when against.link is not set: node_modules, plus the
// node_modules of workspace packages one or two levels down (apps/web/node_modules, packages/core/node_modules), which
// pnpm, Yarn, and npm workspaces create. Without them the old code's tests fail on missing packages, and that failure
// read as "detects the change" (the first real install, a pnpm monorepo, 2026-10-24).
export function defaultLinks(root) {
	const found = ["node_modules"];
	const dirs = (dir) => {
		try {
			return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules");
		} catch {
			return [];
		}
	};
	for (const a of dirs(root)) {
		if (fs.existsSync(path.join(root, a.name, "node_modules"))) found.push(`${a.name}/node_modules`);
		for (const b of dirs(path.join(root, a.name))) if (fs.existsSync(path.join(root, a.name, b.name, "node_modules"))) found.push(`${a.name}/${b.name}/node_modules`);
	}
	return found;
}

export function createWorktree(root, ref, { prefix = AGAINST_PREFIX, tmpDir, link = ["node_modules"], paths } = {}) {
	const top = gitTop(root);
	if (!top) return { error: "not a git repository" };
	const rel = toPosix(path.relative(realpath(top), realpath(root)));
	const base = path.resolve(root, tmpDir ?? os.tmpdir());
	fs.mkdirSync(base, { recursive: true });
	cleanStaleWorktrees(top, base, prefix);
	const tmp = fs.mkdtempSync(path.join(base, prefix));
	const links = [];
	try {
		const noHooks = path.join(tmp, "no-hooks");
		fs.mkdirSync(noHooks);
		const wt = path.join(tmp, "wt");
		if (paths) {
			// cone mode: the listed folders (relative to the top of the repository) plus the files at the top
			const dirs = [...new Set([rel, ...paths.map((p) => toPosix(path.posix.normalize(path.posix.join(rel, toPosix(p)))))].filter((d) => d && d !== "."))];
			const outside = dirs.find((d) => d === ".." || d.startsWith("../"));
			if (outside) return { error: `against.paths: ${outside} is outside the repository`, top, tmp };
			const add = gitRun(top, ["-c", `core.hooksPath=${noHooks}`, "worktree", "add", "--detach", "--no-checkout", "--quiet", wt, ref]);
			if (add.status !== 0) return { error: `could not check out ${ref}: ${add.stderr.trim()}`, top, tmp };
			const sparse = gitRun(wt, ["sparse-checkout", "set", "--cone", ...dirs]);
			if (sparse.status !== 0) return { error: `could not limit the checkout of ${ref} to ${dirs.join(", ")}: ${sparse.stderr.trim()}`, top, tmp };
			const co = gitRun(wt, ["-c", `core.hooksPath=${noHooks}`, "checkout", "--quiet"]);
			if (co.status !== 0) return { error: `could not check out ${ref}: ${co.stderr.trim()}`, top, tmp };
		} else {
			const add = gitRun(top, ["-c", `core.hooksPath=${noHooks}`, "worktree", "add", "--detach", "--quiet", wt, ref]);
			if (add.status !== 0) return { error: `could not check out ${ref}: ${add.stderr.trim()}`, top, tmp };
		}
		const wtRoot = path.join(wt, rel);
		fs.mkdirSync(wtRoot, { recursive: true });
		for (const name of link) {
			const target = path.join(root, name);
			const at = path.join(wtRoot, name);
			if (!fs.existsSync(target) || fs.existsSync(at)) continue;
			fs.mkdirSync(path.dirname(at), { recursive: true });
			fs.symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
			links.push({ at, target });
		}
		return { top, tmp, wtRoot, links };
	} catch (err) {
		removeWorktree(top, tmp, links);
		return { error: `could not set up a checkout of ${ref}: ${err.message}` };
	}
}

const conclude = (step, config, reason) =>
	config.against?.required ? { ...step, ok: false, problems: [`${reason} (against.required is set, so this fails the run)`] } : { ...step, skipped: `${reason} (inconclusive)` };

export async function runAgainst({ root, config, configRel = ".stack-agent/verify.json", ref: explicit }) {
	const step = { step: "against", ok: true };
	const top = gitTop(root);
	if (!top) return { ...step, skipped: "not a git repository" };
	const ref = resolveAgainstRef(root, config, explicit);
	if (!ref) return { ...step, skipped: "no commit to compare with yet" };
	step.ref = ref;
	const prefix = toPosix(path.relative(realpath(top), realpath(root)));
	// "--" says the argument is a revision, so git does not also try it as a file name; without it a full hash plus a
	// long project path passes Windows' 260-character limit and git fails with "Filename too long"
	const oldText = gitRun(top, ["show", `${ref}:${prefix ? prefix + "/" : ""}${configRel}`, "--"]);
	if (oldText.status !== 0) {
		const err = oldText.stderr.trim();
		if (/does not exist|exists on disk, but not in|bad revision|invalid object name/i.test(err) || !err) return { ...step, skipped: `${configRel} does not exist at ${ref}` };
		return conclude(step, config, `could not read ${configRel} at ${ref}: ${err.split("\n")[0]}`);
	}
	let oldConfig;
	try {
		oldConfig = JSON.parse(oldText.stdout);
	} catch {
		return { ...step, skipped: `${configRel} at ${ref} is not valid JSON` };
	}
	const oldKeys = new Set((oldConfig.checks ?? []).map(assertionKey));
	const newKeys = new Set((config.checks ?? []).map(assertionKey));
	const added = (config.checks ?? []).filter((c) => !oldKeys.has(assertionKey(c)));
	// a check whose assertions changed but whose name is still there was changed, not removed; it runs as a new one
	const newNames = new Set((config.checks ?? []).map((c) => c.name));
	const gone = (oldConfig.checks ?? []).filter((c) => !newKeys.has(assertionKey(c)));
	const removed = gone.filter((c) => !newNames.has(c.name)).map((c) => c.name);
	const changed = gone.filter((c) => newNames.has(c.name)).map((c) => c.name);
	if (removed.length) step.removed = removed;
	if (changed.length) step.changed = changed;
	const keep = config.against?.keep ?? AGAINST_KEEP;
	// new or changed tests count like new checks: a test written for the change should fail on the code before it
	const changedTests = runs(config.test) ? testsChangedSince(root, ref, keep) : [];
	if (!added.length && !changedTests.length) {
		// Code changed and nothing new tests it: the step has nothing to run, so it cannot fail, and the evidence would
		// stand for a change no check or test touched. The flag lets the Stop hook ask once.
		if (!codeChangedSince(root, ref, config, keep).length) return { ...step, skipped: "no new or changed checks or tests" };
		return {
			...step,
			noNewCoverage: true,
			skipped: `no new or changed checks or tests, but the code changed since ${ref}, so nothing shows the change is tested. If it changes behavior, add a test or a check to verify.json that fails without it; if it does not (a refactor), say so`,
		};
	}
	if (!codeChangedSince(root, ref, config, keep).length) return { ...step, skipped: "only checks or tests changed, no code" };
	step.checks = added.map((c) => c.name);
	if (changedTests.length) step.tests = changedTests;

	// with a setup step (often an install) nothing is linked unless asked: an install through a link would rewrite the real folder
	const made = createWorktree(root, ref, { tmpDir: config.against?.tmpDir, link: config.against?.link ?? (config.against?.setup ? [] : defaultLinks(root)), paths: config.against?.paths });
	const { tmp, links = [] } = made;
	try {
		if (made.error) return conclude(step, config, made.error);
		const { wtRoot } = made;
		copyInto(root, wtRoot, configRel);
		for (const rel of gitRun(root, ["ls-files", "-co", "--exclude-standard", "-z"]).stdout.split("\0").filter(Boolean))
			if (matchesAny(rel, keep) && fs.existsSync(path.join(root, rel))) copyInto(root, wtRoot, rel);
		if (config.against?.setup) {
			const r = await runCommand(wtRoot, config.against.setup, 600);
			if (r.exitCode !== 0 || r.timedOut) return conclude(step, config, `against.setup failed on ${ref}: ${tail(r.output, 300)}`);
		}
		const results = [];
		// the current test suite (with the new tests) on the old code: a failure means the tests catch the change
		if (changedTests.length) {
			const t = await runTests(wtRoot, config.test);
			const label = `tests (${shown(config.test)})`;
			// tests that import something the old code lacks (a new export or module) die before they test anything there
			const missingImport = !t.ok && !t.timedOut && (MISSING_RE.test(t.output ?? "") || TEST_IMPORT_RE.test(t.output ?? ""));
			const inconclusive = !t.ok && (t.timedOut || t.exitCode === 127 || t.exitCode === null || missingImport);
			results.push({ name: label, ok: t.ok, inconclusive, missingImport, missingNames: missingImport ? missingImportNames(t.output) : [], kind: "tests" });
		}
		if (added.length) {
			const steps = await runVerify({ root: wtRoot, config, skipTests: true, only: step.checks });
			const server = steps.find((s) => s.step === "server");
			// a missing build, module, or program on the old checkout proves nothing about the change
			for (const s of steps.filter((x) => x.step === "check")) {
				const inconclusive = !s.ok && (s.inconclusive || (s.type === "command" && (s.exitCode === 127 || MISSING_RE.test(s.output ?? ""))));
				results.push({ name: s.name, ok: s.ok, inconclusive: Boolean(inconclusive), kind: "check" });
			}
			if (server && !server.ok) {
				step.note = `the server did not start on the code at ${ref}: ${server.reason}`;
				for (const name of step.checks) if (!results.some((r) => r.name === name)) results.push({ name, ok: false, inconclusive: true, kind: "check" });
			}
		}
		step.detecting = results.filter((s) => !s.ok && !s.inconclusive).map((s) => s.name);
		step.passingBefore = results.filter((s) => s.ok).map((s) => s.name);
		const inconclusive = results.filter((s) => s.inconclusive).map((s) => s.name);
		if (inconclusive.length) step.inconclusive = inconclusive;
		if (step.detecting.length) return step;
		const weakChecks = results.filter((r) => r.ok && r.kind === "check").map((r) => r.name);
		// New checks exist to test new behavior, so one that passes on the old code is a weak check. Changed tests
		// passing on the old code is what a refactor looks like, so that alone is not a failure.
		if (weakChecks.length)
			return {
				...step,
				ok: false,
				problems: [`new check(s) ${weakChecks.join(", ")} also pass on the code before your change (${ref}), so they do not test it. Add a check or test that fails without your change, usually the rejection case.`],
			};
		if (results.some((r) => r.ok && r.kind === "tests"))
			return { ...step, skipped: `the changed tests also pass on the code at ${ref} (expected for a refactor; for new behavior, add a test or check that fails without the change)` };
		// The usual case: the change adds an export and its tests import it, and no new check runs the program. Nothing
		// can then show the tests catch the change; a verify check that runs the program as a user does can. The flag
		// lets the Stop hook ask for one.
		if (!step.note && !added.length && results.some((r) => r.missingImport)) {
			step.importMissing = true;
			const names = [...new Set(results.flatMap((r) => r.missingNames ?? []))];
			if (names.length) step.missingImports = names;
			const what = names.length ? ` (${names.join(", ")})` : "";
			return conclude(
				step,
				config,
				`the changed tests import something the code at ${ref} does not have${what}, so they cannot show that they catch the change. Add a check to verify.json that fails without the change: run the program the way a user does, or, if nothing calls the new code yet, a command check that imports ${names[0] ?? "it"} and prints its result`,
			);
		}
		return conclude(step, config, step.note ?? `every new check and test run was inconclusive on the code at ${ref}`);
	} finally {
		// cleanup problems must not hide the result; a missing link target is reported loudly
		try {
			if (tmp) removeWorktree(top, tmp, links);
		} catch (err) {
			process.stderr.write(`verify: could not fully remove the against worktree at ${tmp}: ${err.message}\n`);
		}
	}
}

function summarize(steps) {
	return steps.map((s) => {
		const mark = s.ok ? "PASS" : "FAIL";
		if (s.step === "against") {
			const removed =
				(s.removed?.length ? `\n  note: check(s) removed since ${s.ref}: ${s.removed.join(", ")}` : "") +
				(s.changed?.length ? `\n  note: check(s) changed since ${s.ref} (run as new checks): ${s.changed.join(", ")}` : "");
			if (s.skipped) return `SKIP against: ${s.skipped}${removed}`;
			return (s.ok ? `PASS against ${s.ref}: ${s.detecting.join(", ")} fail(s) on the code before the change` : `FAIL against ${s.ref}: ${s.problems.join("; ")}`) + removed;
		}
		if (s.step === "repeat") {
			const rate = `red in ${s.red} of ${s.runs} runs (${Math.round((100 * s.red) / s.runs)}%)`;
			const odd = s.inconclusive ? `, ${s.inconclusive} of them inconclusive (timed out, could not start, or no response)` : "";
			const why = s.problems.map((p) => `\n  ${p.count}x ${p.text}`).join("");
			const shownRed = s.firstRed?.output ?? s.firstRed?.body;
			return `${s.red ? "RED" : "PASS"} ${s.type === "tests" ? "tests" : `check ${s.name}`} x${s.runs}: ${s.request} -> ${rate}${odd}${why}${shownRed ? `\n  first red (run ${s.firstRed.run}):\n${shownRed}` : ""}`;
		}
		if (s.step === "tests") return `${mark} tests: ${s.command} (${s.signal ? `killed by ${s.signal}` : `exit ${s.exitCode}`}${s.timedOut ? ", timed out" : ""})${s.ok ? "" : "\n" + s.output}`;
		if (s.step === "server") return `${mark} server: ${s.ok ? "ready" : s.reason}${s.ok || !s.log ? "" : "\n" + s.log}`;
		if (s.type === "command") return `${mark} check ${s.name}: ${s.request} -> exit ${s.exitCode}${s.ok ? "" : " (" + s.problems.join("; ") + ")\n" + s.output}`;
		return `${mark} check ${s.name}: ${s.request} -> ${s.status ?? "no response"}${s.ok ? "" : " (" + s.problems.join("; ") + ")"}`;
	});
}

async function main(argv) {
	const args = parseArgs(argv, { flags: ["skip-tests", "skip-checks", "reuse", "json", "help", "no-against", "evidence-status"], options: ["root", "config", "skip", "against", "repeat"], multi: ["check"] });
	if (args.help) return { code: 0, text: USAGE };
	const repeat = args.repeat === undefined ? undefined : Number(args.repeat);
	if (repeat !== undefined) {
		if (!/^\d+$/.test(args.repeat) || repeat < 2 || repeat > MAX_REPEAT) throw new ConfigError(`--repeat needs a whole number from 2 to ${MAX_REPEAT}`);
		if (!args.check?.length && !args["skip-checks"]) throw new ConfigError("--repeat needs --check NAME (repeat those checks) or --skip-checks (repeat the test suite)");
		if (args.check?.length && args["skip-checks"]) throw new ConfigError("--repeat takes --check NAME or --skip-checks, not both");
		if (args["skip-checks"] && args["skip-tests"]) throw new ConfigError("--skip-checks --repeat repeats the test suite, so it cannot be used with --skip-tests");
		if (args.against !== undefined) throw new ConfigError("--repeat is a partial run, so it never runs the against step; drop --against");
	}
	const root = path.resolve(args.root ?? process.cwd());
	const configPath = path.resolve(root, args.config ?? ".stack-agent/verify.json");
	const config = loadVerifyConfig(configPath);
	if (args.skip !== undefined) return writeSkip(root, config, args.skip);
	if (args["evidence-status"]) return evidenceStatus(root, config, args.json);
	const before = codeFingerprint(root, fingerprintOptions(config));
	const steps = await runVerify({ root, config, skipTests: args["skip-tests"], skipChecks: args["skip-checks"], only: args.check, reuse: args.reuse, repeat });
	if (steps.length === 0) throw new ConfigError("nothing ran: every step was skipped");
	const flags = argv.filter((a) => a.startsWith("--") && !["--root", "--config", "--json", "--against"].includes(a));
	const full = !args["skip-tests"] && !args["skip-checks"] && !args.check?.length && !args.reuse && !repeat;
	const wantAgainst = args.against !== undefined || (config.against !== false && !args["no-against"]);
	if (full && wantAgainst && steps.every((s) => s.ok)) steps.push(await runAgainst({ root, config, configRel: toPosix(path.relative(root, configPath)), ref: args.against }));
	// the Stop hook refuses evidence from a run with the against step off unless the session started that way
	const against = wantAgainst ? "on" : "off";
	// the evidence names the code as it was when the run started; if the run itself changed files (snapshots, codegen,
	// a database outside a gitignored folder) the Stop hook sees the mismatch and says which files to gitignore
	const after = codeFingerprint(root, fingerprintOptions(config));
	const changedByRun = fingerprintDiff(before, after);
	const { record, file } = writeEvidence(root, config, steps, { full, flags, fingerprint: before, ignore: fingerprintOptions(config).ignore, changedByRun, against });
	if (args.json) return { code: record.ok ? 0 : 1, text: JSON.stringify({ ...record, evidence: file }, null, 2) };
	const scope = full ? "" : ` (partial run: ${flags.join(" ")}; run with no flags before calling the change done)`;
	const wrote = changedByRun.length ? [`  note: this run changed ${changedByRun.slice(0, 5).join(", ")}${changedByRun.length > 5 ? ", ..." : ""}; gitignore files that tests or the server write`] : [];
	return { code: record.ok ? 0 : 1, text: [...summarize(steps), ...wrote, `verify: ${record.ok ? "ok" : "FAIL"}, evidence ${file}${scope}`].join("\n") };
}

// Read-only: whether latest.json is a full passing run whose fingerprint matches the code as it is now.
// The reviewer uses it for an uncommitted change; it says nothing about past commits.
function evidenceStatus(root, config, json) {
	const latest = path.resolve(root, config.evidenceDir ?? ".stack-agent/evidence", "latest.json");
	let rec = null;
	try {
		rec = JSON.parse(fs.readFileSync(latest, "utf8"));
	} catch {}
	const current = codeFingerprint(root, fingerprintOptions(config));
	const matches = Boolean(rec?.fingerprint && current && rec.fingerprint === current.value);
	const ok = Boolean(rec?.ok === true && rec.full === true && matches);
	let skip = null;
	try {
		skip = JSON.parse(fs.readFileSync(path.join(root, SKIP_FILE), "utf8"));
	} catch {}
	const skipped = !ok && current && skip?.fingerprint === current.value ? `verification was skipped for this code: ${skip.reason}` : null;
	const why = skipped ?? (!rec ? "no evidence yet" : rec.ok !== true ? "the latest run failed" : rec.full !== true ? "the latest run was partial" : !current ? "not a git repository, so the evidence cannot be matched to the code" : !rec.fingerprint ? "the evidence has no fingerprint (written by an older verify)" : !matches ? "the code changed after the latest run" : "matches the code");
	const status = { ok, full: rec?.full === true, passed: rec?.ok === true, matches, why, evidence: rec ? toPosix(path.relative(root, latest)) : null, at: rec?.at ?? null };
	return { code: ok ? 0 : 1, text: json ? JSON.stringify(status, null, 2) : `evidence: ${ok ? "ok" : "NOT ok"}, ${why}${rec?.at ? ` (run at ${rec.at})` : ""}` };
}

// Written outside the gitignored evidence dir on purpose: the skip shows up in the diff a reviewer reads.
function writeSkip(root, config, reason) {
	reason = String(reason ?? "").trim();
	if (reason.length < MIN_SKIP_REASON) throw new ConfigError(`--skip needs a reason of at least ${MIN_SKIP_REASON} characters saying why verification cannot run here`);
	const fingerprint = codeFingerprint(root, fingerprintOptions(config));
	if (!fingerprint) throw new ConfigError("--skip needs a git repository (the Stop hook only checks changes git can see)");
	const file = path.join(root, SKIP_FILE);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), reason, fingerprint: fingerprint.value }, null, 2) + "\n");
	return { code: 0, text: `verify: skipped, reason recorded in ${SKIP_FILE} for the current code. Tell the user the change is unverified and why.` };
}

// Interrupted (Ctrl+C, a caller's timeout that sends SIGTERM): stop the server and the commands verify started, so
// none is left holding the port for the next run. A hard kill (SIGKILL, Windows TerminateProcess) cannot be caught.
export async function stopAll() {
	await Promise.all([...live].map((child) => stopProcess(child)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]])
		process.once(signal, () => {
			process.stderr.write(`verify: interrupted by ${signal}, stopping what it started\n`);
			stopAll().finally(() => process.exit(code));
		});
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
