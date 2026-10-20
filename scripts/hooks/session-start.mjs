#!/usr/bin/env node
// Records what the code looked like when the session began, so the Stop hook only holds the agent to
// changes made in this session (not to a tree the human left dirty) and verify's against step can compare
// with the code before the session's work, even if the agent commits along the way. The Stop hook settings
// are snapshotted too, so editing verify.json mid-session cannot switch the hook off for that session.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { matchesAny } from "../lib/files.mjs";
import { VERIFY_CONFIG, changedFiles, codeFingerprint, ignoreList } from "../lib/fingerprint.mjs";
import { findUp, readHookInput } from "./read-input.mjs";
import { sessionFile } from "./stop-verify.mjs";

const SESSION_TTL_MS = 7 * 24 * 3600_000;

const input = readHookInput();
const root = findUp(input.cwd ?? process.cwd(), VERIFY_CONFIG);
if (root) {
	let config = {};
	try {
		config = JSON.parse(fs.readFileSync(path.join(root, VERIFY_CONFIG), "utf8"));
	} catch {}
	const evidenceDir = path.resolve(root, config.evidenceDir ?? ".stack-agent/evidence");
	const file = sessionFile(evidenceDir, input.session_id);
	const sessionsDir = path.dirname(file);
	for (const name of fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : []) {
		try {
			const old = path.join(sessionsDir, name);
			if (name.endsWith(".json") && Date.now() - fs.statSync(old).mtimeMs > SESSION_TTL_MS) fs.unlinkSync(old);
		} catch {}
	}
	let existing = {};
	try {
		existing = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {}
	// a resumed or compacted session keeps its first record, or changes made before compaction would be forgotten
	if (!existing.fingerprint) {
		const ignore = ignoreList(config.stopHookIgnore);
		const fingerprint = codeFingerprint(root, { ignore, evidenceDir: config.evidenceDir ?? ".stack-agent/evidence" });
		const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
		if (fingerprint) {
			const dirty = {};
			for (const f of changedFiles(root) ?? []) if (!matchesAny(f, ignore)) dirty[f] = fingerprint.entries.get(f) ?? "deleted";
			fs.mkdirSync(sessionsDir, { recursive: true });
			fs.writeFileSync(
				file,
				JSON.stringify({
					...existing,
					at: new Date().toISOString(),
					fingerprint: fingerprint.value,
					head: head.status === 0 ? head.stdout.trim() : null,
					dirty,
					stopHook: config.stopHook === "remind" ? "remind" : "block",
					stopHookIgnore: ignore,
					againstOff: config.against === false,
				}),
			);
		}
	}
}
