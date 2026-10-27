#!/usr/bin/env node
// Checks that this plugin still loads and its hooks still fire under the Claude Code that is current now. The tests run
// the hook scripts with input this repo made up; only a real Claude Code can say whether the real input still has the
// shape the hooks expect, and Claude Code changes often. Two checks:
//   static  claude --version, and `claude plugin validate --strict` (no credentials, no cost)
//   --live  a headless session in a copy of the sample backend that is asked to run `git commit --no-verify`: the
//           plugin must load, SessionStart must record the session, PreToolUse must deny the command with the hook's
//           own message, and no commit may have been made (needs credentials; the cheapest model, a small budget cap)
// Not vendored by init and not part of npm test: CI runs it weekly (.github/workflows/claude-code-canary.yml).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { claudeArgs, claudeEnv, claudeVersion, parseTranscript, resolveClaude, spawnClaude } from "./ab/lib.mjs";
import { ConfigError, parseArgs } from "./lib/files.mjs";

const USAGE = `usage: node scripts/canary.mjs [--live] [--json] [--root DIR] [--model NAME] [--budget USD]
  --live    also run the headless hook check (needs credentials; a login or key problem skips it, it does not fail)
  --json    print the result as JSON
  --root    the plugin to check (default: this repo)
  --model   model for the live check (default: haiku)
  --budget  spending cap for the live check in USD (default: 0.25)
CLAUDE_BIN names the claude executable when it is not on PATH.
exit codes: 0 every check that ran passed, 1 a check failed, 2 usage error or no claude executable`;

const here = path.dirname(fileURLToPath(import.meta.url));
const PROBE = "git commit --allow-empty --no-verify -m canary";
const PROMPT = `Run exactly this command with the Bash tool, then say in one sentence what happened: ${PROBE}`;
// the hook's own wording (scripts/hooks/pre-bash.mjs); a permission prompt or a model refusal reads differently
const DENIED = "blocked: `git commit --no-verify`";
const NO_CREDENTIALS = /not logged in|please run \/login|invalid api key|no api key|authentication[_ ]error|credit balance/i;

const tail = (text, n = 12) => String(text).trim().split("\n").slice(-n).join("\n");

export function staticChecks({ root, env = process.env }) {
	const claude = resolveClaude(env);
	const version = claudeVersion(claude);
	const r = spawnSync(claude.command, [...claude.prefix, "plugin", "validate", root, "--strict"], { encoding: "utf8", timeout: 120000, env });
	return { ok: r.status === 0, version, detail: tail((r.stdout ?? "") + (r.stderr ?? "")) };
}

const git = (cwd, ...args) => spawnSync("git", ["-c", "user.name=canary", "-c", "user.email=canary@example.com", ...args], { cwd, encoding: "utf8" });

export function liveChecks({ root, env = process.env, model = "haiku", budget = 0.25 }) {
	const claude = resolveClaude(env);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-agent-canary-"));
	try {
		fs.cpSync(path.join(root, "examples", "sample-backend"), dir, { recursive: true });
		git(dir, "init", "-q", "-b", "main");
		git(dir, "add", "-A");
		git(dir, "commit", "-qm", "base");
		const args = claudeArgs({ prompt: PROMPT, model, budget, pluginDir: root, isolate: true, extraTools: ["Bash(git commit:*)"] });
		const r = spawnClaude(claude, args, dir, claudeEnv(true, env).env);
		const text = (r.stdout ?? "") + "\n" + (r.stderr ?? "");
		const parsed = parseTranscript(r.stdout ?? "");
		if (!parsed.init && NO_CREDENTIALS.test(text)) return { ok: true, skipped: true, detail: `no credentials, live check skipped: ${tail(text, 3)}` };
		const problems = [];
		if (!parsed.init) problems.push(`no session started: ${tail(text, 3)}`);
		else if (!(parsed.init.plugins ?? []).some((p) => p.name === "stack-agent")) problems.push("the plugin did not load (no stack-agent in the init event's plugins)");
		if (!parsed.tools.some((t) => t.name === "Bash" && /--no-verify/.test(t.input.command ?? ""))) problems.push("the agent did not run the probe command, so the hook was not tried (a model refusal, or a change in how tools are named)");
		else if (!text.includes(DENIED)) problems.push("the --no-verify commit was not denied by the PreToolUse hook (no \"" + DENIED + "\" message in the session)");
		const commits = Number(git(dir, "rev-list", "--count", "HEAD").stdout.trim());
		if (commits !== 1) problems.push(`a commit was made (${commits} commits, expected 1)`);
		const sessions = path.join(dir, ".stack-agent", "evidence", "sessions");
		if (!fs.existsSync(sessions) || !fs.readdirSync(sessions).some((f) => f.endsWith(".start.json"))) problems.push("the SessionStart hook did not record the session (no .stack-agent/evidence/sessions/*.start.json)");
		const cost = parsed.result?.total_cost_usd;
		return { ok: problems.length === 0, detail: problems.length ? problems.join("; ") : `the plugin loaded, SessionStart recorded the session, PreToolUse denied the --no-verify commit, no commit was made${cost != null ? ` ($${cost})` : ""}` };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
}

export function main(argv, env = process.env) {
	const args = parseArgs(argv, { flags: ["live", "json", "help"], options: ["root", "model", "budget"] });
	if (args.help) return { code: 0, text: USAGE };
	const root = path.resolve(args.root ?? path.join(here, ".."));
	const budget = args.budget === undefined ? 0.25 : Number(args.budget);
	if (!Number.isFinite(budget) || budget <= 0) throw new ConfigError("--budget must be a positive number of US dollars");
	const stat = staticChecks({ root, env });
	const live = args.live ? liveChecks({ root, env, model: args.model ?? "haiku", budget }) : null;
	const code = !stat.ok || (live && !live.ok) ? 1 : 0;
	if (args.json) return { code, text: JSON.stringify({ version: stat.version, static: { ok: stat.ok, detail: stat.detail }, live }, null, 2) };
	const lines = [`claude: ${stat.version}`, `${stat.ok ? "PASS" : "FAIL"} plugin validate --strict${stat.ok ? "" : "\n" + stat.detail.split("\n").map((l) => `    ${l}`).join("\n")}`];
	if (live) lines.push(`${live.skipped ? "SKIP" : live.ok ? "PASS" : "FAIL"} live hook check: ${live.detail}`);
	lines.push(code === 0 ? `canary: ok${live ? "" : " (static only; --live runs the headless hook check)"}` : "canary: FAILED, this plugin may not work under this Claude Code");
	return { code, text: lines.join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		(code === 0 ? console.log : console.error)(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`canary: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
