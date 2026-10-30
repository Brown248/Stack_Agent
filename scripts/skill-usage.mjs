#!/usr/bin/env node
// Counts which skills this project's past Claude Code sessions actually used, from the transcripts Claude Code keeps
// on this machine (read-only; nothing is written and nothing leaves the machine). It adds no hook and no state: the
// transcripts already hold every Skill tool call, every slash command, and every read into a skill's folder.
// Idea from tigerless-labs/autoharness (MIT), which counts loads, views, and patches in a sidecar per skill; here
// the counts come from the history, so they reach back as far as the transcripts do. It reports and never deletes
// or moves a skill. Used by the mine-corrections skill; not vendored by init.
//
// A resumed session starts with a copy of the one it continues, events and ids alike (on one real project 4,422 of
// 6,942 user events were repeats), so an event is counted once, in the file changed earliest that holds it, and a
// file with nothing new in it is not another session. A skill with the same name in two plugins counts as one.
// The transcripts Claude Code keeps for each subagent of a session (<session>/subagents/agent-*.jsonl) are read too, and
// what they hold is counted in that session (1 of 105 Skill loads on the machine this was written on was in one).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs } from "./lib/files.mjs";
import { projectSlug, transcriptDirs, userIds } from "./mine-transcripts.mjs";

const USAGE = `usage: node skill-usage.mjs [--project DIR] [--transcripts DIR] [--days N] [--worktrees] [--min-sessions N] [--skills DIR ...] [--json]
  counts how often each skill was loaded, run as a slash command, or read, in this project's past Claude Code sessions
  --project        the project folder whose sessions to read (default: the current folder)
  --transcripts    read *.jsonl from this folder instead of Claude Code's own folder for the project
  --days N         only sessions changed in the last N days (default 30)
  --worktrees      also read sessions run in the project's worktrees under .claude/worktrees/
  --min-sessions N fewest sessions before a skill with no use is called unused (default 10)
  --skills DIR     more folders of skills to list (each holds <name>/SKILL.md); this plugin's own skills and the
                   project's .claude/skills are always listed
  --json           print the counts as JSON
exit codes: 0 done (even if nothing was found), 2 bad arguments or no transcripts folder`;

const PLUGIN_SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

// "stack-agent:debug" and "debug" are the same skill: the plugin name is only a prefix
export const bareName = (name) => String(name).replace(/^\/+/, "").split(":").pop();

export function installedSkills(dirs) {
	const names = new Map();
	for (const dir of dirs) {
		if (!fs.existsSync(dir)) continue;
		// existsSync follows a link or a junction, which a Dirent would not
		for (const name of fs.readdirSync(dir)) {
			if (fs.existsSync(path.join(dir, name, "SKILL.md"))) names.set(name, dir);
		}
	}
	return names;
}

// Claude Code keeps what each subagent of a session did in <session>/subagents/agent-*.jsonl, next to <session>.jsonl
export function subagentFiles(sessionFile) {
	const dir = path.join(path.dirname(sessionFile), path.basename(sessionFile, ".jsonl"), "subagents");
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort().map((n) => path.join(dir, n));
}

const COMMAND = /<command-name>\/?([^<\s]+)<\/command-name>/;
// the last `skills` folder in the path, whatever the case (Windows paths are not case sensitive): in
// /home/me/skills/shop/.claude/skills/api-map/SKILL.md the skill is api-map, not shop
const SKILL_DIR = /^.*[\\/]skills[\\/]([^\\/]+)[\\/]/i;

const textOf = (event) => {
	const content = event.message?.content;
	if (typeof content === "string") return content;
	return Array.isArray(content) ? content.filter((p) => p?.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n") : "";
};

// events of one transcript that mention a skill: { kind: "load" | "slash" | "view", name, at, key }. `key` names the
// event itself (the tool call's id, or the user event's id) so a copy of it in another file is not counted twice.
export function skillEventsIn(text) {
	const out = [];
	for (const line of text.split("\n")) {
		// a cheap test first: most lines of a transcript have nothing to do with a skill
		if (!line.includes('"Skill"') && !line.includes('"Read"') && !line.includes("<command-name>")) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		const at = event?.timestamp ?? null;
		if (event?.type === "assistant") {
			const parts = event.message?.content;
			for (const part of Array.isArray(parts) ? parts : []) {
				if (part?.type !== "tool_use") continue;
				const key = typeof part.id === "string" ? `t:${part.id}` : null;
				if (part.name === "Skill" && typeof part.input?.skill === "string") out.push({ kind: "load", name: part.input.skill, at, key });
				else if (part.name === "Read" && typeof part.input?.file_path === "string") {
					const m = SKILL_DIR.exec(part.input.file_path);
					if (m) out.push({ kind: "view", name: m[1], at, key });
				}
			}
		} else if (event?.type === "user" && !event.isMeta && !event.isSidechain) {
			const m = COMMAND.exec(textOf(event));
			if (m) out.push({ kind: "slash", name: m[1], at, key: typeof event.uuid === "string" ? `u:${event.uuid}` : null });
		}
	}
	return out;
}

// A slash command is a skill only if it names one we know of (a skill in a folder we list, or one the model loaded
// through the Skill tool): /model, /clear, and the rest are not.
export function count({ files, known, days = 30, now = Date.now(), minSessions = 10 }) {
	const sessions = [];
	const seenUsers = new Set();
	const seenEvents = new Set();
	const recent = files
		.map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
		.filter((f) => now - f.mtime <= days * 86400000)
		.sort((a, b) => a.mtime - b.mtime || a.file.localeCompare(b.file));
	for (const { file } of recent) {
		const text = fs.readFileSync(file, "utf8");
		const ids = userIds(text);
		// a file whose user events all appeared in an older one and that adds no skill event is a copy, not another session
		const copy = ids.length > 0 && ids.every((id) => seenUsers.has(id));
		for (const id of ids) seenUsers.add(id);
		const events = skillEventsIn(text).filter((e) => {
			if (!e.key) return true;
			if (seenEvents.has(e.key)) return false;
			seenEvents.add(e.key);
			return true;
		});
		// what the session's subagents loaded is the session's own: counted in it, not as another session
		for (const sub of subagentFiles(file)) {
			for (const e of skillEventsIn(fs.readFileSync(sub, "utf8"))) {
				if (e.key && seenEvents.has(e.key)) continue;
				if (e.key) seenEvents.add(e.key);
				events.push(e);
			}
		}
		if (copy && !events.length) continue;
		sessions.push({ id: path.basename(file, ".jsonl"), events });
	}
	const loaded = new Set(sessions.flatMap((s) => s.events.filter((e) => e.kind === "load").map((e) => bareName(e.name))));
	const names = new Set([...known.keys(), ...loaded]);
	const rows = new Map([...names].map((name) => [name, { name, installed: known.has(name), loads: 0, slash: 0, views: 0, sessions: new Set(), last: null }]));
	for (const s of sessions) {
		for (const e of s.events) {
			const row = rows.get(bareName(e.name));
			if (!row) continue;
			if (e.kind === "load") row.loads++;
			else if (e.kind === "slash") row.slash++;
			else row.views++;
			if (e.kind !== "view") row.sessions.add(s.id);
			if (e.at && (!row.last || e.at > row.last)) row.last = e.at;
		}
	}
	const list = [...rows.values()].map((r) => ({ ...r, sessions: r.sessions.size, last: r.last }));
	const used = list.filter((r) => r.loads + r.slash > 0).sort((a, b) => b.loads + b.slash - (a.loads + a.slash) || a.name.localeCompare(b.name));
	const viewedOnly = list.filter((r) => r.loads + r.slash === 0 && r.views > 0).sort((a, b) => a.name.localeCompare(b.name));
	const idle = list.filter((r) => r.installed && r.loads + r.slash + r.views === 0).sort((a, b) => a.name.localeCompare(b.name));
	return { sessions: sessions.length, enough: sessions.length >= minSessions, minSessions, used, viewedOnly, unused: idle };
}

export function report(result, { days = 30 } = {}) {
	const last = (r) => `last ${String(r.last ?? "").slice(0, 10) || "?"}`;
	// a skill that was only read is in no session as a use, so it does not say "in 0 session(s)"
	const fmt = (r) =>
		`  ${r.name}${r.installed ? "" : " (not installed here)"}: loaded ${r.loads}, slash command ${r.slash}${r.views ? `, read ${r.views}` : ""}${r.loads + r.slash ? `, in ${r.sessions} session(s)` : ""}, ${last(r)}`;
	const lines = [`${result.sessions} session(s) from the last ${days} day(s)`];
	lines.push(result.used.length ? "used:" : "used: none", ...result.used.map(fmt));
	if (result.viewedOnly.length) lines.push("read but never loaded or run (somebody looked, nothing followed it):", ...result.viewedOnly.map(fmt));
	if (!result.unused.length) lines.push("not used: none of the skills listed");
	else if (result.enough) lines.push(`not used in ${result.sessions} session(s): ${result.unused.map((r) => r.name).join(", ")}`, "(a skill kept for a rare job can be fine; this lists, it does not say remove)");
	else lines.push(`not used so far: ${result.unused.map((r) => r.name).join(", ")}`, `(only ${result.sessions} session(s), fewer than ${result.minSessions}: too few to call any skill unused)`);
	return lines.join("\n");
}

export function main(argv) {
	const args = parseArgs(argv, { flags: ["worktrees", "json", "help"], options: ["project", "transcripts", "days", "min-sessions"], multi: ["skills"] });
	if (args.help) return { code: 0, text: USAGE };
	const days = Number(args.days ?? 30);
	if (!Number.isFinite(days) || days <= 0) throw new ConfigError(`--days must be a positive number, got "${args.days}"`);
	const minSessions = Number(args["min-sessions"] ?? 10);
	if (!Number.isInteger(minSessions) || minSessions < 1) throw new ConfigError(`--min-sessions must be a whole number of at least 1, got "${args["min-sessions"]}"`);
	const project = path.resolve(args.project ?? process.cwd());
	const dirs = args.transcripts ? [path.resolve(args.transcripts)] : transcriptDirs(project, { worktrees: args.worktrees });
	if (!dirs.length || !dirs.every((d) => fs.existsSync(d))) throw new ConfigError(`no Claude Code transcripts for ${project} (looked for the folder ${projectSlug(project)} under Claude Code's projects folder)`);
	const files = dirs.flatMap((dir) => fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).map((n) => path.join(dir, n)));
	const known = installedSkills([path.join(project, ".claude", "skills"), PLUGIN_SKILLS, ...(args.skills ?? []).map((d) => path.resolve(d))]);
	const result = count({ files, known, days, minSessions });
	return { code: 0, text: args.json ? JSON.stringify({ days, ...result }, null, 2) : report(result, { days }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		console.log(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`skill-usage: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
