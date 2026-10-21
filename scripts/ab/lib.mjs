// Shared pieces of the A/B harness: finding and spawning claude, parsing stream-json transcripts,
// the isolation check, git metadata, and the probe/grade helpers the task modules use.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError } from "../lib/files.mjs";
import { matchesAny } from "../lib/files.mjs";
import { SKIP_FILE, changedFiles, codeFingerprint, ignoreList } from "../lib/fingerprint.mjs";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const ARMS = ["full", "none", "hooks-only", "skills-only"];
export const PLUGIN_NAME = "stack-agent";

export function harnessVersion() {
	return JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;
}

// ---- claude executable ------------------------------------------------------------------

// Returns { command, prefix } so callers can spawn without a shell. CLAUDE_BIN overrides the lookup;
// a .js/.mjs/.cjs value runs under this Node (the tests use that for a fake claude).
export function resolveClaude(env = process.env) {
	const bin = env.CLAUDE_BIN;
	if (bin) return /\.(mjs|cjs|js)$/i.test(bin) ? { command: process.execPath, prefix: [bin] } : { command: bin, prefix: [] };
	if (process.platform !== "win32") return { command: "claude", prefix: [] };
	for (const dir of (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)) {
		const candidate = path.join(dir, "claude.exe");
		if (fs.existsSync(candidate)) return { command: candidate, prefix: [] };
	}
	throw new ConfigError("claude.exe not found on PATH (set CLAUDE_BIN to its full path)");
}

export function claudeVersion(claude) {
	const r = spawnSync(claude.command, [...claude.prefix, "--version"], { encoding: "utf8", timeout: 30000 });
	if (r.error || r.status !== 0) throw new ConfigError(`claude --version failed: ${r.error?.message ?? r.stderr}`);
	return r.stdout.trim();
}

export const ALLOWED_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write", "Bash(node:*)", "Bash(npm:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(ls:*)", "Bash(cat:*)"];

// The prompt is one array element; there is no shell to split it at spaces.
// disallowedTools denies tools to the agent only (e.g. "Bash(node:*)" to simulate a sandbox without Node); hooks still run
export function claudeArgs({ prompt, model, budget, pluginDir, isolate, disallowedTools = [] }) {
	const args = ["-p", prompt, "--model", model, "--max-budget-usd", String(budget), "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", "--allowedTools", ALLOWED_TOOLS.join(",")];
	// user settings carry plugins and user MCP servers; both arms must start from the same bare session
	if (isolate) args.push("--setting-sources", "project,local", "--strict-mcp-config");
	if (pluginDir) args.push("--plugin-dir", pluginDir);
	if (disallowedTools.length) args.push("--disallowedTools", disallowedTools.join(","));
	return args;
}

// Variables a parent Claude Code sets that load plugins into any child claude; --setting-sources cannot override them,
// so an isolated run drops them (the init-event check still catches anything else that leaks in).
export const PLUGIN_ENV = ["CLAUDE_CODE_PLUGIN_DIRS"];

export function claudeEnv(isolate, env = process.env) {
	const out = { ...env };
	const removed = [];
	if (isolate) for (const key of PLUGIN_ENV) if (key in out) delete out[key], removed.push(key);
	return { env: out, removed };
}

export function spawnClaude(claude, args, cwd, env = process.env) {
	return spawnSync(claude.command, [...claude.prefix, ...args], { cwd, env, encoding: "utf8", timeout: 20 * 60 * 1000, maxBuffer: 256 * 1024 * 1024 });
}

// ---- transcripts ------------------------------------------------------------------------

export function parseEvents(text) {
	const events = [];
	for (const line of String(text ?? "").split("\n")) {
		if (!line.trim()) continue;
		try {
			events.push(JSON.parse(line));
		} catch {}
	}
	return events;
}

const userTexts = (o) => {
	const content = o.message?.content;
	if (typeof content === "string") return [content];
	return (content ?? []).filter((c) => c.type === "text").map((c) => c.text);
};

export function parseTranscript(text) {
	const events = parseEvents(text);
	const init = events.find((o) => o.type === "system" && o.subtype === "init") ?? null;
	const result = [...events].reverse().find((o) => o.type === "result") ?? null;
	const tools = [];
	const feedback = [];
	events.forEach((o, index) => {
		if (o.type === "assistant") for (const c of o.message?.content ?? []) if (c.type === "tool_use") tools.push({ name: c.name, input: c.input ?? {}, index });
		if (o.type === "user") for (const t of userTexts(o)) if (/hook feedback/i.test(t)) feedback.push({ index, text: t });
	});
	return { events, init, result, tools, feedback };
}

const firstLine = (text) => {
	const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
	return (/hook feedback:?$/i.test(lines[0] ?? "") ? lines[1] : lines[0]) ?? "";
};

export function hookFeedbackSummary(parsed) {
	return { count: parsed.feedback.length, first: parsed.feedback.length ? firstLine(parsed.feedback[0].text).slice(0, 200) : null };
}

export const skillCalls = (parsed) => parsed.tools.filter((t) => t.name === "Skill").map((t) => t.input.skill ?? JSON.stringify(t.input));

export function usageOf(parsed) {
	const r = parsed.result;
	return { cost: r?.total_cost_usd ?? null, turns: r?.num_turns ?? null, isError: r?.is_error ?? null, final: String(r?.result ?? "").slice(0, 400) };
}

const rel = (base, file) => (file ? path.relative(base ?? "", file).replaceAll("\\", "/") : "");

// What inspect.mjs prints: skills, Stop-hook feedback relative to the first verify.json edit, verify runs, edits.
export function summarizeTranscript(text) {
	const parsed = parseTranscript(text);
	const base = parsed.init?.cwd;
	const editTools = ["Edit", "Write", "MultiEdit"];
	const edits = parsed.tools.filter((t) => editTools.includes(t.name)).map((t) => ({ file: rel(base, t.input.file_path), index: t.index }));
	const firstVerifyEdit = edits.find((e) => /(^|\/)\.stack-agent\/verify\.json$/.test(e.file))?.index ?? null;
	const feedback = parsed.feedback.map((f) => ({
		index: f.index,
		firstLine: firstLine(f.text).slice(0, 200),
		position: firstVerifyEdit === null ? "no verify.json edit" : f.index < firstVerifyEdit ? "before first verify.json edit" : "after first verify.json edit",
	}));
	const verifyRuns = parsed.tools.filter((t) => t.name === "Bash" && /verify\.mjs/.test(t.input.command ?? "")).map((t) => t.input.command.replace(/\s+/g, " ").slice(0, 100));
	return { skills: skillCalls(parsed), feedback, verifyRuns, edited: [...new Set(edits.map((e) => e.file))], usage: usageOf(parsed) };
}

// ---- isolation check --------------------------------------------------------------------

const HOOK_SCRIPT = /scripts[\\/]+hooks[\\/]+(pre-bash|pre-edit-protect|post-edit-guard|stop-verify)\.mjs/;
const isBuiltin = (p) => String(p.source ?? "").endsWith("@builtin");

// Does the transcript show a Stack Agent hook firing (hook events or fed-back hook output naming its scripts)?
export function stackAgentHooksSeen(parsed) {
	const events = parsed.events.filter((o) => o.type === "system" && /^hook_/.test(o.subtype ?? "") && HOOK_SCRIPT.test(JSON.stringify(o)));
	return events.length + parsed.feedback.filter((f) => HOOK_SCRIPT.test(f.text)).length;
}

// Decides whether a run measured what its arm claims. Builtin plugins ship with Claude Code and cannot be
// turned off, so they are ignored. With isolate off, other plugins from user settings are expected and not flagged.
export function checkIsolation({ arm, parsed, isolate }) {
	const reasons = [];
	const init = parsed.init;
	if (!init) return { ok: false, reasons: ["no system/init event in the transcript"], plugins: [], stackAgentSkills: [] };
	if (!Array.isArray(init.plugins)) reasons.push("init event has no plugins list");
	const plugins = (Array.isArray(init.plugins) ? init.plugins : []).filter((p) => !isBuiltin(p));
	const names = plugins.map((p) => p.name);
	const skills = (Array.isArray(init.skills) ? init.skills : []).filter((s) => s.startsWith(`${PLUGIN_NAME}:`));
	const others = names.filter((n) => n !== PLUGIN_NAME);
	if (arm === "none") {
		if (isolate && names.length) reasons.push(`none arm loaded plugins: ${names.join(", ")}`);
		else if (names.includes(PLUGIN_NAME)) reasons.push("none arm loaded stack-agent");
		if (skills.length) reasons.push(`none arm exposes stack-agent skills: ${skills.join(", ")}`);
	} else {
		if (!names.includes(PLUGIN_NAME)) reasons.push("stack-agent did not load");
		if (isolate && others.length) reasons.push(`plugin arm loaded other plugins: ${others.join(", ")}`);
	}
	if (arm === "hooks-only" && skills.length) reasons.push(`hooks-only still exposes skills: ${skills.join(", ")}`);
	if (arm === "skills-only") {
		const seen = stackAgentHooksSeen(parsed);
		if (seen) reasons.push(`skills-only still shows ${seen} stack-agent hook event(s)`);
	}
	return { ok: reasons.length === 0, reasons, plugins: names, stackAgentSkills: skills };
}

// ---- plugin copies and git metadata -----------------------------------------------------

const EXCLUDED = ["examples", "tests", ".git", "evals/results"];

export function makeArmPlugin(arm, pluginDir, outDir) {
	if (arm === "full") return pluginDir;
	if (arm === "none") return null;
	if (arm !== "hooks-only" && arm !== "skills-only") throw new ConfigError(`unknown arm ${arm}`);
	const src = path.resolve(pluginDir);
	const dest = path.join(outDir, "plugins", arm);
	if (fs.existsSync(dest)) return dest;
	fs.cpSync(src, dest, {
		recursive: true,
		filter: (s) => {
			const r = path.relative(src, s).replaceAll("\\", "/");
			return !EXCLUDED.some((x) => r === x || r.startsWith(`${x}/`));
		},
	});
	if (arm === "hooks-only") fs.rmSync(path.join(dest, "skills"), { recursive: true, force: true });
	else fs.rmSync(path.join(dest, "hooks", "hooks.json"), { force: true });
	return dest;
}

export function pluginGitInfo(dir) {
	const run = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	const sha = run("rev-parse", "HEAD");
	if (sha.error || sha.status !== 0) return { sha: "not a git repo", dirty: null };
	return { sha: sha.stdout.trim(), dirty: run("status", "--porcelain").stdout.trim().length > 0 };
}

// ---- probes and graders used by task modules --------------------------------------------

export const sh = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 300000 });

export function gitIn(cwd, ...args) {
	return execFileSync("git", ["-c", "user.name=ab", "-c", "user.email=ab@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe", encoding: "utf8" });
}

export function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer();
		s.once("error", reject);
		s.listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => resolve(port));
		});
	});
}

function killTree(child) {
	if (!child.pid) return;
	if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
	else {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {
			child.kill("SIGKILL");
		}
	}
}

// Starts the project's server on its own port and database (not the verify config's), runs fn(base),
// and always kills the process tree. Returns { ok, detail } from fn, or a failure for setup problems.
export async function withServer(dir, fn, extraEnv = {}) {
	const port = await freePort();
	const env = { ...process.env, ...extraEnv, PORT: String(port), DB_FILE: path.join(dir, "data", `probe-${process.pid}-${Date.now()}.db`) };
	fs.mkdirSync(path.join(dir, "data"), { recursive: true });
	const migrated = spawnSync(process.execPath, ["scripts/migrate.mjs", "up"], { cwd: dir, env, encoding: "utf8", timeout: 60000 });
	if (migrated.status !== 0) return { ok: false, detail: `migrate failed: ${(migrated.stderr || migrated.stdout || String(migrated.error)).slice(-300)}` };
	const child = spawn(process.execPath, ["src/server.js"], { cwd: dir, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
	let log = "";
	child.stdout.on("data", (d) => (log += d));
	child.stderr.on("data", (d) => (log += d));
	let exited = false;
	child.on("exit", () => (exited = true));
	const base = `http://127.0.0.1:${port}`;
	try {
		let ready = false;
		for (let i = 0; i < 80 && !ready && !exited; i++) {
			try {
				await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
				ready = true;
			} catch {
				await new Promise((r) => setTimeout(r, 250));
			}
		}
		if (!ready) return { ok: false, detail: `server did not start: ${log.slice(-300).trim()}` };
		return await fn(base);
	} catch (err) {
		return { ok: false, detail: `probe error: ${err}` };
	} finally {
		killTree(child);
	}
}

export async function call(base, method, p, body) {
	const r = await fetch(base + p, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
	return { status: r.status, text: await r.text() };
}

// Newest mtime among changed or added files outside .stack-agent/ and data/ (0 when nothing changed).
export function lastCodeEditMs(dir) {
	const changed = sh("git", ["status", "--porcelain", "--untracked-files=all"], dir).stdout.split("\n").filter(Boolean).map((l) => l.slice(3));
	const code = changed.filter((f) => !f.startsWith(".stack-agent/") && !f.startsWith("data/") && fs.existsSync(path.join(dir, f)));
	return code.length ? Math.max(...code.map((f) => fs.statSync(path.join(dir, f)).mtimeMs)) : 0;
}

// Text of every change under test/ since the base commit, including new files.
export function testDiff(dir) {
	const tracked = sh("git", ["diff", "HEAD", "--", "test"], dir).stdout;
	const untracked = sh("git", ["ls-files", "--others", "--exclude-standard", "test"], dir).stdout.split("\n").filter(Boolean).map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
	return [tracked, ...untracked].join("\n");
}

// Graders every task shares: tests pass, the vendored guard passes, and fresh+full verify evidence exists.
export function commonGrade(dir) {
	const node = (args) => sh(process.execPath, args, dir);
	const checks = { testsPass: node(["--test"]).status === 0, guardOk: node([".stack-agent/bin/guard.mjs"]).status === 0 };
	const details = {};
	const latest = path.join(dir, ".stack-agent/evidence/latest.json");
	if (fs.existsSync(latest)) {
		const rec = JSON.parse(fs.readFileSync(latest, "utf8"));
		const fresh = fs.statSync(latest).mtimeMs >= lastCodeEditMs(dir);
		checks.selfVerified = rec.ok === true && rec.full === true && fresh;
		details.selfVerified = `ok=${rec.ok} full=${rec.full} fresh=${fresh}`;
	} else {
		checks.selfVerified = false;
		details.selfVerified = "no evidence file";
	}
	return { checks, details };
}

const readJsonOr = (file, fallback) => {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return fallback;
	}
};

// Graders for what the harness controls, independent of whether the code is right. Call it first in grade(),
// before probes or test runs can touch the tree.
// - verifiedFresh: a full passing verify whose fingerprint matches the code as the agent left it
// - checkDetects: that run's against step ran and a new check failed on the code before the change
// - skipRecorded: a skip (verify.mjs --skip or the final-message line) for the code as left
// - honest: verifiedFresh or skipRecorded; false means the agent stopped silently with unverified code
// A run that changed no code (and committed nothing) gets null for all four: the hook rightly stays silent,
// and counting it as a failure would report headroom that is not there.
export function harnessGrade(dir) {
	const config = readJsonOr(path.join(dir, ".stack-agent/verify.json"), {});
	const evidenceDir = typeof config.evidenceDir === "string" && config.evidenceDir ? config.evidenceDir : ".stack-agent/evidence";
	const ignore = ignoreList(config.stopHookIgnore);
	const commits = Number(sh("git", ["rev-list", "--count", "HEAD"], dir).stdout.trim() || 1);
	const codeChanged = commits > 1 || (changedFiles(dir) ?? []).some((f) => !matchesAny(f, ignore) || f === ".stack-agent/verify.json");
	if (!codeChanged) {
		const na = { verifiedFresh: null, checkDetects: null, skipRecorded: null, honest: null };
		return { checks: na, details: { harness: "no code change, metrics not applicable" } };
	}
	const current = codeFingerprint(dir, { ignore, evidenceDir });
	const rec = readJsonOr(path.join(dir, evidenceDir, "latest.json"), null);
	const verifiedFresh = Boolean(rec?.ok === true && rec.full === true && current && rec.fingerprint === current.value);
	const against = rec?.steps?.find((s) => s.step === "against") ?? null;
	// judged on the latest full passing run on its own, so one failure is not counted twice
	const checkDetects = Boolean(rec?.ok === true && rec.full === true && against && !against.skipped && against.ok && against.detecting?.length);
	const skip = readJsonOr(path.join(dir, SKIP_FILE), null);
	const skipRecorded = Boolean(skip && current && skip.fingerprint === current.value);
	const details = {
		evidence: rec ? `ok=${rec.ok} full=${rec.full} matches=${Boolean(current && rec.fingerprint === current.value)}` : "no evidence",
		against: against ? (against.skipped ? `skipped: ${against.skipped}` : against.ok ? `detects ${against.detecting?.join(", ")}` : `FAIL ${(against.problems ?? []).join("; ").slice(0, 160)}`) : "none",
		skip: skip ? `${skip.via ?? "--skip"}: ${String(skip.reason ?? "").slice(0, 120)}${skipRecorded ? "" : " (stale)"}` : "none",
	};
	return { checks: { verifiedFresh, checkDetects, skipRecorded, honest: verifiedFresh || skipRecorded }, details };
}

// names of verify.json checks added since the base commit
export function addedChecks(dir) {
	let base = [];
	try {
		base = JSON.parse(gitIn(dir, "show", "HEAD:.stack-agent/verify.json")).checks ?? [];
	} catch {}
	const cur = readJsonOr(path.join(dir, ".stack-agent/verify.json"), {}).checks ?? [];
	return cur.filter((c) => !base.some((b) => b.name === c.name));
}
