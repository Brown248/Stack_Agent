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
// blob ids of the files the guard hooks last checked, so a shell command is only blamed for what it changed
export const seenFile = (root, sessionId) => path.join(sessionsDir(root), `${safeId(sessionId)}.seen.json`);

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

const isRegularFile = (abs) => {
	try {
		return fs.statSync(abs).isFile();
	} catch {
		return false;
	}
};

const hashOne = (root, rel) => {
	const r = spawnSync("git", ["hash-object", "--", rel], { cwd: root, encoding: "utf8" });
	return r.status === 0 ? r.stdout.trim() : null;
};

// rel path -> git blob id; a file that cannot be hashed (unreadable, gone) is left out, and only that file. One git
// call hashes the batch; a name --stdin-paths cannot carry (a newline, a leading quote, which git unquotes) or a batch
// that fails is hashed one file at a time.
export function blobIds(root, rels) {
	const ids = new Map();
	const plain = rels.filter((rel) => !rel.includes("\n") && !rel.startsWith('"'));
	const odd = rels.filter((rel) => !plain.includes(rel));
	let single = odd;
	if (plain.length) {
		const r = spawnSync("git", ["hash-object", "--stdin-paths"], { cwd: root, input: plain.join("\n") + "\n", encoding: "utf8" });
		const out = r.status === 0 ? r.stdout.trim().split("\n") : [];
		if (out.length === plain.length) plain.forEach((rel, i) => ids.set(rel, out[i]));
		else single = rels;
	}
	for (const rel of single) {
		const id = hashOne(root, rel);
		if (id) ids.set(rel, id);
	}
	return ids;
}

// What the guard hooks last saw, as rel path -> blob id: the snapshot the after-shell hook writes, then every line the
// after-edit hook appended to the log since that snapshot. Before the first snapshot, the files left dirty when the
// session started. The after-edit hook only appends, and appends do not overwrite each other, so hooks running at
// the same time do not lose each other's entries.
const seenLog = (root, sessionId) => seenFile(root, sessionId).replace(/\.json$/, ".log");

function readLog(root, sessionId, from = 0) {
	let text = "";
	try {
		text = fs.readFileSync(seenLog(root, sessionId)).subarray(from).toString("utf8");
	} catch {}
	const ids = {};
	for (const line of text.split("\n")) {
		try {
			const [rel, id] = JSON.parse(line);
			if (typeof rel === "string" && typeof id === "string") ids[rel] = id;
		} catch {}
	}
	return ids;
}

function logSize(root, sessionId) {
	try {
		return fs.statSync(seenLog(root, sessionId)).size;
	} catch {
		return 0;
	}
}

export function readSeen(root, sessionId) {
	const snap = readJsonOr(seenFile(root, sessionId), null);
	const start = readStart(root, sessionId);
	const base = snap?.ids ?? { ...(start?.guardSeen ?? start?.dirty ?? {}) };
	return { ...base, ...readLog(root, sessionId, snap?.logOffset ?? 0) };
}

// the after-shell hook: the full map as it now stands; the log offset is taken before reading, so a line appended
// while this runs is read again next time instead of being lost
export function writeSeen(root, sessionId, ids, logOffset) {
	try {
		fs.mkdirSync(sessionsDir(root), { recursive: true });
		const file = seenFile(root, sessionId);
		const tmp = `${file}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify({ ids, logOffset }));
		fs.renameSync(tmp, file);
	} catch {}
}

export const seenLogOffset = logSize;

// What the after-shell guard reported, one JSON line per report. A session transcript does not carry a hook's
// output, so this is the record that a report was made (for a person checking afterwards, and for A/B grading).
export const reportsLog = (root, sessionId) => seenFile(root, sessionId).replace(/\.seen\.json$/, ".reports.log");

export function noteReport(root, sessionId, violations) {
	try {
		fs.mkdirSync(sessionsDir(root), { recursive: true });
		fs.appendFileSync(reportsLog(root, sessionId), JSON.stringify({ at: new Date().toISOString(), hook: "post-bash", violations }) + "\n");
	} catch {}
}

// the after-edit hook: one line per checked file
export function noteSeen(root, sessionId, rel, id) {
	try {
		fs.mkdirSync(sessionsDir(root), { recursive: true });
		fs.appendFileSync(seenLog(root, sessionId), JSON.stringify([rel, id]) + "\n");
	} catch {}
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
	const ids = new Set((fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((n) => n.endsWith(".json")).map((n) => n.replace(/(\.start|\.seen)?\.json$/, "")));
	for (const id of ids) {
		if (Date.now() - lastActivity(root, id) <= SESSION_TTL_MS) continue;
		// the notes go with the record, so a session resumed after pruning starts clean instead of looking tampered with
		for (const file of [startFile(root, id), stateFile(root, id), seenFile(root, id), seenLog(root, id), reportsLog(root, id), ledgerFile(root, id, "taken"), ledgerFile(root, id, "skipped")]) {
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
	const changed = changedFiles(root) ?? [];
	for (const f of changed) if (!matchesAny(f, ignore)) dirty[f] = fingerprint.entries.get(f) ?? "deleted";
	// every file left dirty, docs included: the guard hooks do not blame a session for what was there before it, and
	// guard rules can cover files the Stop hook's fingerprint leaves out (a conflict marker in a .md file)
	const guardSeen = Object.fromEntries(blobIds(root, changed.filter((f) => isRegularFile(path.join(root, f)))));
	const record = {
		at: new Date().toISOString(),
		fingerprint: fingerprint.value,
		head: head.status === 0 ? head.stdout.trim() : null,
		dirty,
		guardSeen,
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
