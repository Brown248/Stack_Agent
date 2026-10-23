#!/usr/bin/env node
// Reads this project's past Claude Code transcripts (read-only, on this machine) and lists what the user wrote
// after the agent had answered: the corrections a mining run groups into lessons. It writes nothing and calls
// nothing outside the machine. Used by the mine-corrections skill; not vendored by init.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs } from "./lib/files.mjs";

const USAGE = `usage: node mine-transcripts.mjs [--project DIR] [--transcripts DIR] [--days N] [--all] [--worktrees] [--json]
  lists what the user wrote after an agent reply, in this project's past Claude Code sessions
  --project      the project folder whose sessions to read (default: the current folder)
  --transcripts  read *.jsonl from this folder instead of Claude Code's own folder for the project
  --days N       only sessions changed in the last N days (default 30)
  --all          every user message after an agent reply, not only those that look like a correction
  --worktrees    also read sessions run in the project's worktrees under .claude/worktrees/
exit codes: 0 done (even if nothing was found), 2 bad arguments or no transcripts folder`;

// how Claude Code names a project's transcript folder: every character other than a letter or digit becomes "-"
export const projectSlug = (dir) => path.resolve(dir).replace(/[^A-Za-z0-9]/g, "-");
const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");

export function transcriptDirs(project, { worktrees = false, base = path.join(configDir(), "projects") } = {}) {
	const slug = projectSlug(project);
	if (!fs.existsSync(base)) return [];
	return fs
		.readdirSync(base, { withFileTypes: true })
		.filter((d) => d.isDirectory() && (d.name === slug || (worktrees && d.name.startsWith(slug + "--claude-worktrees-"))))
		.map((d) => path.join(base, d.name));
}

// Blocks the harness adds to a user turn (reminders, slash-command echoes, background-task notices) are not
// something the user wrote.
const INJECTED = /<(system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-stderr|task-notification|user-prompt-submit-hook)>[\s\S]*?<\/\1>/g;

export function userText(event) {
	if (event.type !== "user" || event.isMeta || event.isSidechain) return null;
	const content = event.message?.content;
	const parts = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
	if (parts.some((p) => p.type === "tool_result")) return null;
	const text = parts
		.filter((p) => p.type === "text")
		.map((p) => p.text.replace(INJECTED, ""))
		.join("\n")
		.trim();
	// Claude Code's own note when the user pressed Esc
	if (/^\[Request interrupted by user[^\]]*\]$/.test(text)) return null;
	return text || null;
}

const assistantText = (event) =>
	event.type === "assistant" && !event.isSidechain
		? (event.message?.content ?? [])
				.filter((p) => p.type === "text")
				.map((p) => p.text)
				.join("\n")
				.trim()
		: "";

// words people use when they correct an agent, in English and Thai; a hint for the skill, not a verdict
const CORRECTION = /\b(no|not|don't|do not|didn't|stop|instead|wrong|again|still|already told|should(?:n't)?|never|always|why did|you forgot|revert|undo|only|must)\b|ไม่|อย่า|ห้าม|ผิด|อีกแล้ว|ทำไม|แก้|ลืม|บอกแล้ว|ต้อง|เท่านั้น/i;

export function correctionsIn(text, { all = false, session = null } = {}) {
	const out = [];
	let lastReply = "";
	let first = true;
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		const reply = assistantText(event);
		if (reply) {
			lastReply = reply;
			continue;
		}
		const said = userText(event);
		if (said === null) continue;
		// the opening request of a session is the task, not a correction
		if (first || !lastReply) {
			first = false;
			continue;
		}
		if (all || CORRECTION.test(said)) out.push({ session: session ?? event.sessionId ?? null, at: event.timestamp ?? null, text: said.slice(0, 600), after: lastReply.slice(-300) });
		lastReply = "";
	}
	return out;
}

export function mine({ dirs, days = 30, all = false, now = Date.now() }) {
	const found = [];
	let sessions = 0;
	for (const dir of dirs) {
		for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
			const file = path.join(dir, name);
			if (now - fs.statSync(file).mtimeMs > days * 86400000) continue;
			sessions++;
			found.push(...correctionsIn(fs.readFileSync(file, "utf8"), { all, session: name.replace(/\.jsonl$/, "") }));
		}
	}
	return { sessions, found: found.sort((a, b) => String(a.at).localeCompare(String(b.at))) };
}

export function main(argv) {
	const args = parseArgs(argv, { flags: ["all", "worktrees", "json", "help"], options: ["project", "transcripts", "days"] });
	if (args.help) return { code: 0, text: USAGE };
	const days = Number(args.days ?? 30);
	if (!Number.isFinite(days) || days <= 0) throw new ConfigError(`--days must be a positive number, got "${args.days}"`);
	const project = path.resolve(args.project ?? process.cwd());
	const dirs = args.transcripts ? [path.resolve(args.transcripts)] : transcriptDirs(project, { worktrees: args.worktrees });
	if (!dirs.length || !dirs.every((d) => fs.existsSync(d))) throw new ConfigError(`no Claude Code transcripts for ${project} (looked for ${path.join(configDir(), "projects", projectSlug(project))})`);
	const { sessions, found } = mine({ dirs, days, all: args.all });
	if (args.json) return { code: 0, text: JSON.stringify({ sessions, count: found.length, found }, null, 2) };
	const lines = found.map((f) => `- [${f.session?.slice(0, 8) ?? "?"} ${String(f.at ?? "").slice(0, 10)}] ${f.text.replace(/\s+/g, " ").slice(0, 200)}`);
	return { code: 0, text: [`${found.length} message(s) after an agent reply in ${sessions} session(s) from the last ${days} day(s)`, ...lines].join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		console.log(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`mine-transcripts: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
