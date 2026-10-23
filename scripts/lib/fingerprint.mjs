// A fingerprint of the code a verify run tested, so the Stop hook can tell whether evidence still matches the
// working tree. Every file is identified by its git blob id (changed and untracked files through
// `git hash-object`, which applies the same eol/clean filters as a commit), so committing does not change it.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { matchesAny, toPosix } from "./files.mjs";

export const VERIFY_CONFIG = ".stack-agent/verify.json";
// Raise it whenever codeFingerprint would give a different value for the same code, so the Stop hook can tell
// evidence from a verify.mjs that computes fingerprints differently from code that changed.
export const FINGERPRINT_VERSION = 1;
export const SKIP_FILE = ".stack-agent/verify-skip.json";
export const STOP_IGNORE = ["**/*.md", ".stack-agent/**", "docs/**"];
// the hooks' own records; a fixed path, whatever evidenceDir says
export const SESSIONS_DIR = ".stack-agent/evidence/sessions";

// one rule for every reader of stopHookIgnore, so verify, SessionStart, and Stop always agree on the list
export const ignoreList = (value) => (Array.isArray(value) && value.every((g) => typeof g === "string") ? value : STOP_IGNORE);
const MAX_HASHED = 5000;

const git = (cwd, args, input) => spawnSync("git", args, { cwd, encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });

export function gitTop(root) {
	const r = git(root, ["rev-parse", "--show-toplevel"]);
	return r.status === 0 ? r.stdout.trim() : null;
}

export function parsePorcelainZ(out) {
	const entries = out.split("\0");
	const paths = [];
	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (e.length < 4) continue;
		paths.push(e.slice(3));
		if (e[0] === "R" || e[0] === "C") i++;
	}
	return paths;
}

const real = (p) => {
	try {
		return fs.realpathSync.native(p);
	} catch {
		return path.resolve(p);
	}
};

// paths git reports as changed or untracked under root, relative to root (posix); null outside a git repo
export function changedFiles(root) {
	const top = gitTop(root);
	if (!top) return null;
	const r = git(top, ["status", "--porcelain", "-z", "--untracked-files=all"]);
	if (r.status !== 0) return null;
	const base = real(root);
	return parsePorcelainZ(r.stdout)
		.map((p) => toPosix(path.relative(base, path.join(real(top), p))))
		.filter((p) => !p.startsWith("../") && !path.isAbsolute(p));
}

// The verify config always counts. The skip record, evidence, and the hooks' session records never count,
// whatever stopHookIgnore says, so writing them cannot change the fingerprint they record.
function counts(rel, ignore, evidenceRel) {
	if (rel === SKIP_FILE || rel === evidenceRel || rel.startsWith(evidenceRel + "/") || rel.startsWith(SESSIONS_DIR + "/")) return false;
	return rel === VERIFY_CONFIG || !matchesAny(rel, ignore);
}

// { value, entries } or null (not a git repo, or too many changed files to hash within a hook's time limit)
export function codeFingerprint(root, { ignore = STOP_IGNORE, evidenceDir = ".stack-agent/evidence" } = {}) {
	const topRaw = gitTop(root);
	if (!topRaw) return null;
	const top = real(topRaw);
	const base = real(root);
	const evidenceRel = toPosix(path.relative(base, path.resolve(base, evidenceDir)));
	const toRel = (topRel) => toPosix(path.relative(base, path.join(top, topRel)));
	const entries = new Map();
	const listed = git(topRaw, ["ls-files", "-s", "-z", "--full-name"]);
	if (listed.status !== 0) return null;
	for (const line of listed.stdout.split("\0")) {
		const m = /^(\d+) ([0-9a-f]+) \d\t(.+)$/s.exec(line);
		if (!m || m[1] === "160000") continue;
		const rel = toRel(m[3]);
		if (!rel.startsWith("../") && !path.isAbsolute(rel)) entries.set(rel, m[2]);
	}
	const status = git(topRaw, ["status", "--porcelain", "-z", "--untracked-files=all"]);
	if (status.status !== 0) return null;
	const toHash = [];
	for (const topRel of parsePorcelainZ(status.stdout)) {
		const rel = toRel(topRel);
		if (rel.startsWith("../") || path.isAbsolute(rel) || !counts(rel, ignore, evidenceRel)) continue;
		const abs = path.join(top, topRel);
		let isFile = false;
		try {
			isFile = fs.statSync(abs).isFile();
		} catch {}
		if (isFile && !topRel.includes("\n")) toHash.push([rel, topRel]);
		else entries.set(rel, "deleted");
	}
	if (toHash.length > MAX_HASHED) return null;
	if (toHash.length) {
		const hashed = git(topRaw, ["hash-object", "--stdin-paths"], toHash.map(([, t]) => t).join("\n") + "\n");
		if (hashed.status !== 0) return null;
		const oids = hashed.stdout.trim().split("\n");
		toHash.forEach(([rel], i) => entries.set(rel, oids[i]));
	}
	for (const rel of [...entries.keys()]) if (!counts(rel, ignore, evidenceRel)) entries.delete(rel);
	const lines = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([p, id]) => `${p}\0${id}\n`);
	return { value: crypto.createHash("sha256").update(lines.join("")).digest("hex"), entries };
}

// paths whose id differs between two fingerprints (for telling the user what a run changed)
export function fingerprintDiff(a, b) {
	if (!a || !b) return [];
	const out = [];
	for (const [p, id] of b.entries) if (a.entries.get(p) !== id) out.push(p);
	for (const p of a.entries.keys()) if (!b.entries.has(p)) out.push(p);
	return out.sort();
}
