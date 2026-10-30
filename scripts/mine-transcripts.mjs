#!/usr/bin/env node
// Reads this project's past Claude Code transcripts (read-only, on this machine) and lists what the user wrote
// after the agent had answered: the corrections a mining run groups into lessons. It writes nothing and calls
// nothing outside the machine, and it hides keys, passwords, and personal details before anything is printed
// (lib/redact.mjs). Used by the mine-corrections skill; not vendored by init.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs } from "./lib/files.mjs";
import { addCounts, redact } from "./lib/redact.mjs";

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
	if (event?.type !== "user" || event.isMeta || event.isSidechain) return null;
	const content = event.message?.content;
	const parts = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
	if (parts.some((p) => p?.type === "tool_result")) return null;
	const text = parts
		.filter((p) => p?.type === "text" && typeof p.text === "string")
		.map((p) => p.text.replace(INJECTED, ""))
		.join("\n")
		.trim();
	// Claude Code's own note when the user pressed Esc
	if (/^\[Request interrupted by user[^\]]*\]$/.test(text)) return null;
	return text || null;
}

const assistantText = (event) =>
	event?.type === "assistant" && !event.isSidechain && Array.isArray(event.message?.content)
		? event.message.content
				.filter((p) => p?.type === "text" && typeof p.text === "string")
				.map((p) => p.text)
				.join("\n")
				.trim()
		: "";

// words people use when they correct an agent, in English and Thai; a hint for the skill, not a verdict
const CORRECTION = /\b(no|not|don't|do not|didn't|stop|instead|wrong|again|still|already told|should(?:n't)?|never|always|why did|you forgot|revert|undo|only|must)\b|ไม่|อย่า|ห้าม|ผิด|อีกแล้ว|ทำไม|แก้|ลืม|บอกแล้ว|ต้อง|เท่านั้น/i;

// `counts`, when given, collects how many secrets of each kind were hidden (lib/redact.mjs). Redaction comes before
// the text is cut to length, so a key is never left half-visible.
export function correctionsIn(text, { all = false, session = null, counts = null, seen = null } = {}) {
	const hide = (s) => {
		const r = redact(s);
		if (counts) addCounts(counts, r.counts);
		return r.text;
	};
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
		// a resumed session starts with a copy of the earlier one, events and ids alike: the first file to hold an id keeps it
		const copy = seen && event.uuid ? seen.has(event.uuid) : false;
		if (!copy && (all || CORRECTION.test(said))) out.push({ id: event.uuid ?? null, session: session ?? event.sessionId ?? null, at: event.timestamp ?? null, text: hide(said).slice(0, 600), after: hide(lastReply).slice(-300) });
		lastReply = "";
	}
	return out;
}

// ids of the user events in a transcript: how a copy of an earlier session, made when one is resumed, is told apart
export function userIds(text) {
	const ids = [];
	for (const line of text.split("\n")) {
		if (!line.includes('"type":"user"')) continue;
		const m = /"uuid":"([^"]+)"/.exec(line);
		if (m) ids.push(m[1]);
	}
	return ids;
}

// the transcript files changed in the last `days`, oldest first, so the session a copy was made from comes first
export function recentFiles(dirs, { days = 30, now = Date.now() } = {}) {
	const files = [];
	for (const dir of dirs) {
		for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
			const file = path.join(dir, name);
			const mtime = fs.statSync(file).mtimeMs;
			if (now - mtime <= days * 86400000) files.push({ file, name, mtime });
		}
	}
	return files.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
}

export function mine({ dirs, days = 30, all = false, now = Date.now() }) {
	const found = [];
	const redacted = {};
	const seen = new Set();
	let sessions = 0;
	for (const { file, name } of recentFiles(dirs, { days, now })) {
		const text = fs.readFileSync(file, "utf8");
		// a file whose user events all appeared in an earlier one and that adds nothing is a copy, not another session
		const ids = userIds(text);
		const copy = ids.length > 0 && ids.every((id) => seen.has(id));
		const items = correctionsIn(text, { all, session: name.replace(/\.jsonl$/, ""), counts: redacted, seen });
		for (const id of ids) seen.add(id);
		if (copy && !items.length) continue;
		sessions++;
		found.push(...items);
	}
	return { sessions, found: found.sort((a, b) => String(a.at).localeCompare(String(b.at))), redacted };
}

export function main(argv) {
	const args = parseArgs(argv, { flags: ["all", "worktrees", "json", "help"], options: ["project", "transcripts", "days"] });
	if (args.help) return { code: 0, text: USAGE };
	const days = Number(args.days ?? 30);
	if (!Number.isFinite(days) || days <= 0) throw new ConfigError(`--days must be a positive number, got "${args.days}"`);
	const project = path.resolve(args.project ?? process.cwd());
	const dirs = args.transcripts ? [path.resolve(args.transcripts)] : transcriptDirs(project, { worktrees: args.worktrees });
	if (!dirs.length || !dirs.every((d) => fs.existsSync(d))) throw new ConfigError(`no Claude Code transcripts for ${project} (looked for ${path.join(configDir(), "projects", projectSlug(project))})`);
	const { sessions, found, redacted } = mine({ dirs, days, all: args.all });
	const hidden = Object.values(redacted).reduce((a, b) => a + b, 0);
	if (args.json) return { code: 0, text: JSON.stringify({ sessions, count: found.length, redacted, found }, null, 2) };
	const lines = found.map((f) => `- [${f.session?.slice(0, 8) ?? "?"} ${String(f.at ?? "").slice(0, 10)}] ${f.text.replace(/\s+/g, " ").slice(0, 200)}`);
	const note = hidden ? [`${hidden} secret(s) or personal detail(s) were replaced by [REDACTED:...] (${Object.entries(redacted).map(([k, n]) => `${k} ${n}`).join(", ")})`] : [];
	return { code: 0, text: [`${found.length} message(s) after an agent reply in ${sessions} session(s) from the last ${days} day(s)`, ...note, ...lines].join("\n") };
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
