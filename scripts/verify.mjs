#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { ConfigError, matchesAny, parseArgs, readJson, requireStringArray, toPosix } from "./lib/files.mjs";
import { SKIP_FILE, changedFiles, codeFingerprint, fingerprintDiff, gitTop, ignoreList } from "./lib/fingerprint.mjs";

const USAGE = `usage: node verify.mjs [--root DIR] [--config FILE] [--skip-tests] [--skip-checks]
                      [--check NAME...] [--reuse] [--json] [--against GIT_REF | --no-against]
       node verify.mjs --skip "REASON"   record why verification cannot run for the current code
exit codes: 0 all passed, 1 a step failed, 2 config or environment error`;
const MIN_SKIP_REASON = 15;

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
		throw new ConfigError("against must be true, false, or an object with keep, link, setup, tmpDir, required");
	if (config.against && typeof config.against === "object") {
		const a = config.against;
		for (const key of ["keep", "link"]) requireStringArray(a[key], `against.${key}`, { optional: true });
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

// `command` runs through the platform shell; `args` runs the program directly, so quoting is the same on every OS.
function spawnTree(spec, cwd, env) {
	const options = { cwd, detached: process.platform !== "win32", env: childEnv(env), windowsHide: true };
	return spec.args ? spawn(spec.args[0], spec.args.slice(1), { ...options, shell: false }) : spawn(spec.command, { ...options, shell: true });
}

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
	let startError;
	const exitCode = await new Promise((resolve) => {
		const timer = setTimeout(async () => {
			timedOut = true;
			await stopProcess(child);
		}, (timeoutSec ?? defaultTimeoutSec) * 1000);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve(code);
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			startError = startFailure(spec, err);
			resolve(null);
		});
	});
	const { text, truncated } = output();
	return { exitCode, timedOut, startError, output: startError ? [startError, text].filter(Boolean).join("\n") : text, truncated, durationMs: Date.now() - started };
}

async function runTests(root, test) {
	const r = await runCommand(root, test, 600);
	return { step: "tests", command: shown(test), ...(test.args && { args: test.args }), ok: r.exitCode === 0 && !r.timedOut, exitCode: r.exitCode, timedOut: r.timedOut, durationMs: r.durationMs, output: tail(r.output) };
}

async function runCommandCheck(root, check) {
	const r = await runCommand(root, check, 120);
	const expectExit = check.expectExit ?? 0;
	const problems = [];
	if (r.startError) problems.push(r.startError);
	else if (r.timedOut) problems.push(`timed out after ${check.timeoutSec ?? 120}s`);
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
		return { ...result, ok: false, inconclusive: true, problems: [`request failed: ${err.cause?.code ?? err.message}`], durationMs: Date.now() - started };
	}
}

function gitHead(root) {
	const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root, encoding: "utf8" });
	const dirty = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
	return r.status === 0 ? { head: r.stdout.trim(), dirty: dirty.stdout.trim().length > 0 } : null;
}

export async function runVerify({ root, config, skipTests, skipChecks, only, reuse }) {
	const steps = [];
	if (runs(config.test) && !skipTests) steps.push(await runTests(root, config.test));

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
			for (const check of checks) steps.push(checkType(check) === "command" ? await runCommandCheck(root, check) : await runCheck(config.baseUrl, check));
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
	const record = { at, ok: steps.length > 0 && steps.every((s) => s.ok), full: run.full, flags: run.flags, git: gitHead(root), fingerprint: run.fingerprint?.value ?? null, ignore: run.ignore, against: run.against };
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
	const dir = path.join(path.resolve(root, config.evidenceDir ?? ".stack-agent/evidence"), "sessions");
	// among sessions active in the last day whose start is behind HEAD, the earliest start: with two sessions in one
	// repo that compares with more history, never less, so neither session's checks are hidden by the other's commits
	let earliest = null;
	for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
		try {
			const file = path.join(dir, f);
			if (Date.now() - fs.statSync(file).mtimeMs > 24 * 3600_000) continue;
			const { head, at } = JSON.parse(fs.readFileSync(file, "utf8"));
			// a long-resumed session keeps a days-old start; comparing with it would count everyone's checks since then as new
			if (!(Date.now() - Date.parse(at) <= 3 * 24 * 3600_000)) continue;
			if (!head || !isCommit(head) || gitRun(root, ["merge-base", "--is-ancestor", head, "HEAD"]).status !== 0) continue;
			if (!earliest || String(at) < earliest.at) earliest = { head, at: String(at) };
		} catch {}
	}
	return earliest?.head ?? "HEAD";
}

function codeChangedSince(root, ref, config, keep) {
	const paths = new Set(gitRun(root, ["diff", "--name-only", "-z", "--relative", ref, "--", "."]).stdout.split("\0").filter(Boolean));
	for (const p of changedFiles(root) ?? []) paths.add(p);
	const ignore = ignoreList(config.stopHookIgnore);
	return [...paths].filter((p) => !p.startsWith(".stack-agent/") && !matchesAny(p, ignore) && !matchesAny(p, keep));
}

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

function removeWorktree(top, tmp, links) {
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
function cleanStaleWorktrees(top, base) {
	for (const name of fs.existsSync(base) ? fs.readdirSync(base) : []) {
		if (!name.startsWith(AGAINST_PREFIX)) continue;
		const tmp = path.join(base, name);
		try {
			if (Date.now() - fs.statSync(tmp).mtimeMs > 2 * 3600_000) removeWorktree(top, tmp, []);
		} catch {}
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
	const oldText = gitRun(top, ["show", `${ref}:${prefix ? prefix + "/" : ""}${configRel}`]);
	if (oldText.status !== 0) return { ...step, skipped: `${configRel} does not exist at ${ref}` };
	let oldConfig;
	try {
		oldConfig = JSON.parse(oldText.stdout);
	} catch {
		return { ...step, skipped: `${configRel} at ${ref} is not valid JSON` };
	}
	const oldKeys = new Set((oldConfig.checks ?? []).map(assertionKey));
	const newKeys = new Set((config.checks ?? []).map(assertionKey));
	const added = (config.checks ?? []).filter((c) => !oldKeys.has(assertionKey(c)));
	const removed = (oldConfig.checks ?? []).filter((c) => !newKeys.has(assertionKey(c))).map((c) => c.name);
	if (removed.length) step.removed = removed;
	if (!added.length) return { ...step, skipped: "no new or changed checks" };
	const keep = config.against?.keep ?? AGAINST_KEEP;
	if (!codeChangedSince(root, ref, config, keep).length) return { ...step, skipped: "only checks or tests changed, no code" };
	step.checks = added.map((c) => c.name);

	const base = path.resolve(root, config.against?.tmpDir ?? os.tmpdir());
	fs.mkdirSync(base, { recursive: true });
	cleanStaleWorktrees(top, base);
	const tmp = fs.mkdtempSync(path.join(base, AGAINST_PREFIX));
	const links = [];
	try {
		const noHooks = path.join(tmp, "no-hooks");
		fs.mkdirSync(noHooks);
		const wt = path.join(tmp, "wt");
		const add = gitRun(top, ["-c", `core.hooksPath=${noHooks}`, "worktree", "add", "--detach", "--quiet", wt, ref]);
		if (add.status !== 0) return conclude(step, config, `could not check out ${ref}: ${add.stderr.trim()}`);
		const wtRoot = path.join(wt, prefix);
		fs.mkdirSync(wtRoot, { recursive: true });
		copyInto(root, wtRoot, configRel);
		for (const rel of gitRun(root, ["ls-files", "-co", "--exclude-standard", "-z"]).stdout.split("\0").filter(Boolean))
			if (matchesAny(rel, keep) && fs.existsSync(path.join(root, rel))) copyInto(root, wtRoot, rel);
		// with a setup step (often an install) nothing is linked unless asked: an install through a link would rewrite the real folder
		for (const rel of config.against?.link ?? (config.against?.setup ? [] : ["node_modules"])) {
			const target = path.join(root, rel);
			const at = path.join(wtRoot, rel);
			if (!fs.existsSync(target) || fs.existsSync(at)) continue;
			fs.mkdirSync(path.dirname(at), { recursive: true });
			fs.symlinkSync(target, at, process.platform === "win32" ? "junction" : "dir");
			links.push({ at, target });
		}
		if (config.against?.setup) {
			const r = await runCommand(wtRoot, config.against.setup, 600);
			if (r.exitCode !== 0 || r.timedOut) return conclude(step, config, `against.setup failed on ${ref}: ${tail(r.output, 300)}`);
		}
		const steps = await runVerify({ root: wtRoot, config, skipTests: true, only: step.checks });
		const server = steps.find((s) => s.step === "server");
		if (server && !server.ok) return conclude(step, config, `the server did not start on the code at ${ref}: ${server.reason}`);
		// a missing build, module, or program on the old checkout proves nothing about the change
		const results = steps.filter((s) => s.step === "check").map((s) => (s.type === "command" && !s.ok && (s.exitCode === 127 || MISSING_RE.test(s.output ?? "")) ? { ...s, inconclusive: true } : s));
		step.detecting = results.filter((s) => !s.ok && !s.inconclusive).map((s) => s.name);
		step.passingBefore = results.filter((s) => s.ok).map((s) => s.name);
		const inconclusive = results.filter((s) => s.inconclusive).map((s) => s.name);
		if (inconclusive.length) step.inconclusive = inconclusive;
		if (step.detecting.length) return step;
		if (!step.passingBefore.length) return conclude(step, config, `every new check was inconclusive on the code at ${ref}`);
		return {
			...step,
			ok: false,
			problems: [`new check(s) ${step.passingBefore.join(", ")} also pass on the code before your change (${ref}), so they do not test it. Add a check that fails without your change, usually the rejection case.`],
		};
	} finally {
		// cleanup problems must not hide the result; a missing link target is reported loudly
		try {
			removeWorktree(top, tmp, links);
		} catch (err) {
			process.stderr.write(`verify: could not fully remove the against worktree at ${tmp}: ${err.message}\n`);
		}
	}
}

function summarize(steps) {
	return steps.map((s) => {
		const mark = s.ok ? "PASS" : "FAIL";
		if (s.step === "against") {
			const removed = s.removed?.length ? `\n  note: check(s) removed since ${s.ref}: ${s.removed.join(", ")}` : "";
			if (s.skipped) return `SKIP against: ${s.skipped}${removed}`;
			return (s.ok ? `PASS against ${s.ref}: ${s.detecting.join(", ")} fail(s) on the code before the change` : `FAIL against ${s.ref}: ${s.problems.join("; ")}`) + removed;
		}
		if (s.step === "tests") return `${mark} tests: ${s.command} (exit ${s.exitCode}${s.timedOut ? ", timed out" : ""})${s.ok ? "" : "\n" + s.output}`;
		if (s.step === "server") return `${mark} server: ${s.ok ? "ready" : s.reason}${s.ok || !s.log ? "" : "\n" + s.log}`;
		if (s.type === "command") return `${mark} check ${s.name}: ${s.request} -> exit ${s.exitCode}${s.ok ? "" : " (" + s.problems.join("; ") + ")\n" + s.output}`;
		return `${mark} check ${s.name}: ${s.request} -> ${s.status ?? "no response"}${s.ok ? "" : " (" + s.problems.join("; ") + ")"}`;
	});
}

async function main(argv) {
	const args = parseArgs(argv, { flags: ["skip-tests", "skip-checks", "reuse", "json", "help", "no-against"], options: ["root", "config", "skip", "against"], multi: ["check"] });
	if (args.help) return { code: 0, text: USAGE };
	const root = path.resolve(args.root ?? process.cwd());
	const configPath = path.resolve(root, args.config ?? ".stack-agent/verify.json");
	const config = loadVerifyConfig(configPath);
	if (args.skip !== undefined) return writeSkip(root, config, args.skip);
	const before = codeFingerprint(root, fingerprintOptions(config));
	const steps = await runVerify({ root, config, skipTests: args["skip-tests"], skipChecks: args["skip-checks"], only: args.check, reuse: args.reuse });
	if (steps.length === 0) throw new ConfigError("nothing ran: every step was skipped");
	const flags = argv.filter((a) => a.startsWith("--") && !["--root", "--config", "--json", "--against"].includes(a));
	const full = !args["skip-tests"] && !args["skip-checks"] && !args.check?.length && !args.reuse;
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
