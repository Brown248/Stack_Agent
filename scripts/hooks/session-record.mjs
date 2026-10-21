// The session record: what the code and the Stop hook's settings looked like before the agent changed anything.
// It always lives at a fixed path (never under a configurable evidenceDir), so editing verify.json mid-session
// cannot move or hide it. The baseline file is written once (first writer wins, flag "wx"): SessionStart writes
// it, and the PreToolUse hooks write it before the first edit or command when SessionStart did not run (plugin
// enabled mid-session). The Stop hook keeps its mutable counters in a separate state file.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchesAny } from "../lib/files.mjs";
import { SESSIONS_DIR, VERIFY_CONFIG, changedFiles, codeFingerprint, ignoreList } from "../lib/fingerprint.mjs";

const SESSION_TTL_MS = 7 * 24 * 3600_000;
const safeId = (sessionId) => String(sessionId ?? "default").replace(/[^\w-]/g, "_");

export const sessionsDir = (root) => path.join(root, SESSIONS_DIR);
export const startFile = (root, sessionId) => path.join(sessionsDir(root), `${safeId(sessionId)}.start.json`);
export const stateFile = (root, sessionId) => path.join(sessionsDir(root), `${safeId(sessionId)}.json`);

// A note outside the repo that this session already had a baseline (or that taking one was skipped), so deleting
// the in-repo record cannot make a later hook take a fresh baseline from an already-changed tree.
function realLower(p) {
	let r;
	try {
		r = fs.realpathSync.native(p);
	} catch {
		r = path.resolve(p);
	}
	return process.platform === "win32" ? r.toLowerCase() : r;
}
// the plugin's own data folder when Claude Code provides it (outside the project), else the system temp folder
export const ledgerDir = () => path.join(process.env.CLAUDE_PLUGIN_DATA || os.tmpdir(), "stack-agent-sessions");
const rootKey = (root) => crypto.createHash("sha1").update(realLower(root)).digest("hex").slice(0, 16);
export function ledgerFile(root, sessionId, kind = "taken") {
	return path.join(ledgerDir(), `${rootKey(root)}-${safeId(sessionId)}.${kind}`);
}
function note(root, sessionId, kind) {
	try {
		const file = ledgerFile(root, sessionId, kind);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, new Date().toISOString());
	} catch {}
}
// true when this session took a baseline that is no longer there
export function recordLost(root, sessionId) {
	return !readStart(root, sessionId) && fs.existsSync(ledgerFile(root, sessionId, "taken"));
}

const readJsonOr = (file, fallback) => {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return fallback;
	}
};

export function readConfig(root) {
	return readJsonOr(path.join(root, VERIFY_CONFIG), {});
}

// the baseline for this session, or null; a record from before the start/state split counts if it has a fingerprint
export function readStart(root, sessionId) {
	const start = readJsonOr(startFile(root, sessionId), null);
	if (start?.fingerprint) return start;
	const legacy = readJsonOr(stateFile(root, sessionId), null);
	return legacy?.fingerprint ? legacy : null;
}

export function readState(root, sessionId) {
	return readJsonOr(stateFile(root, sessionId), {});
}

// best effort: a read-only tree or a full disk must never make a hook fail
export function writeState(root, sessionId, state) {
	try {
		fs.mkdirSync(sessionsDir(root), { recursive: true });
		fs.writeFileSync(stateFile(root, sessionId), JSON.stringify(state));
		return true;
	} catch {
		return false;
	}
}

// last activity of a session: the newest of its start file (written once) and its state file (rewritten each stop)
export function lastActivity(root, id) {
	let newest = 0;
	for (const file of [startFile(root, id), stateFile(root, id)]) {
		try {
			newest = Math.max(newest, fs.statSync(file).mtimeMs);
		} catch {}
	}
	return newest;
}

// notes for sessions idle longer than the record TTL, in any project
function pruneLedger() {
	const dir = ledgerDir();
	for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
		try {
			const file = path.join(dir, name);
			if (Date.now() - fs.statSync(file).mtimeMs > 4 * SESSION_TTL_MS) fs.unlinkSync(file);
		} catch {}
	}
}

function pruneOld(root) {
	pruneLedger();
	const dir = sessionsDir(root);
	const ids = new Set((fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((n) => n.endsWith(".json")).map((n) => n.replace(/(\.start)?\.json$/, "")));
	for (const id of ids) {
		if (Date.now() - lastActivity(root, id) <= SESSION_TTL_MS) continue;
		// the notes go with the record, so a session resumed after pruning starts clean instead of looking tampered with
		for (const file of [startFile(root, id), stateFile(root, id), ledgerFile(root, id, "taken"), ledgerFile(root, id, "skipped")]) {
			try {
				fs.unlinkSync(file);
			} catch {}
		}
	}
}

// Writes the baseline if this session has none. Returns "created", "exists", or "skipped" (not git, or unwritable).
export function ensureSessionRecord(root, sessionId) {
	if (readStart(root, sessionId)) return "exists";
	// taken once already (and since removed), or skipped before: never take a new baseline mid-session
	if (fs.existsSync(ledgerFile(root, sessionId, "taken"))) return "lost";
	if (fs.existsSync(ledgerFile(root, sessionId, "skipped"))) return "skipped";
	const config = readConfig(root);
	const ignore = ignoreList(config.stopHookIgnore);
	const evidenceDir = typeof config.evidenceDir === "string" && config.evidenceDir ? config.evidenceDir : ".stack-agent/evidence";
	const fingerprint = codeFingerprint(root, { ignore, evidenceDir });
	if (!fingerprint) {
		note(root, sessionId, "skipped");
		return "skipped";
	}
	const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
	const dirty = {};
	for (const f of changedFiles(root) ?? []) if (!matchesAny(f, ignore)) dirty[f] = fingerprint.entries.get(f) ?? "deleted";
	const record = {
		at: new Date().toISOString(),
		fingerprint: fingerprint.value,
		head: head.status === 0 ? head.stdout.trim() : null,
		dirty,
		stopHook: config.stopHook === "remind" ? "remind" : "block",
		stopHookIgnore: ignore,
		evidenceDir,
		againstOff: config.against === false,
	};
	try {
		fs.mkdirSync(sessionsDir(root), { recursive: true });
		pruneOld(root);
		fs.writeFileSync(startFile(root, sessionId), JSON.stringify(record), { flag: "wx" });
		note(root, sessionId, "taken");
		return "created";
	} catch (err) {
		// a transient write error (a locked file) is not remembered, so the next call tries again
		return err?.code === "EEXIST" ? "exists" : "skipped";
	}
}
