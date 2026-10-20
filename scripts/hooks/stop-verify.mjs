#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesAny } from "../lib/files.mjs";
import { SKIP_FILE, VERIFY_CONFIG as VERIFY, changedFiles, codeFingerprint, ignoreList, parsePorcelainZ } from "../lib/fingerprint.mjs";
import { findUp, readHookInput } from "./read-input.mjs";

export { changedFiles, parsePorcelainZ };
export const MAX_BLOCKS = 3;
const MIN_SKIP_REASON = 15;

// Why the evidence does not cover the current code, or null when it does. Evidence written before fingerprints
// existed (or outside git) falls back to "written after the newest changed file".
// againstOff: whether the project had the against step off when the session started (the live config without a record)
export function staleReason(evidence, current, newestMtimeMs, sessionStart = null, againstOff = false) {
	if (!evidence) return "there is no verify evidence yet";
	if (!evidence.ok) return "the latest verify run failed";
	if (!evidence.full) return "the latest verify run was partial (skipped steps, a --check filter, or --reuse)";
	if (sessionStart?.stopHookIgnore && evidence.ignore && JSON.stringify(evidence.ignore) !== JSON.stringify(sessionStart.stopHookIgnore))
		return "the latest verify run used a different stopHookIgnore than this session started with (that setting takes effect from the next session; put it back to verify this one)";
	if (evidence.against === "off" && !(sessionStart ? sessionStart.againstOff : againstOff))
		return "the latest verify run turned the against step off (--no-against or \"against\": false), which this session did not start with";
	const matches = evidence.fingerprint && current ? evidence.fingerprint === current.value : evidence.mtimeMs >= newestMtimeMs;
	if (matches) return null;
	if (evidence.changedByRun?.length) return `the verify run itself changed ${evidence.changedByRun.slice(0, 3).join(", ")}, so its evidence does not match the code (gitignore files that tests or the server write)`;
	return "the code changed after the latest passing verify run";
}

export const isFresh = (evidence, current, newestMtimeMs, sessionStart, againstOff) => staleReason(evidence, current, newestMtimeMs, sessionStart, againstOff) === null;

function relevantFiles(root, files, ignore) {
	return files.filter((f) => !matchesAny(f, ignore) && fs.existsSync(path.join(root, f)));
}

const newestMtime = (root, files) => (files.length ? Math.max(...files.map((f) => fs.statSync(path.join(root, f)).mtimeMs)) : 0);

// "remind" mode: one reminder per change set, the behavior before blocking existed
export function decide({ root, files, ignore, evidence, reminded, current = null, againstOff = false }) {
	const existing = relevantFiles(root, files, ignore);
	if (existing.length === 0) return { block: false };
	const newest = newestMtime(root, existing);
	const why = staleReason(evidence, current, newest, null, againstOff);
	if (!why) return { block: false };
	const fingerprint = crypto.createHash("sha1").update(current?.value ?? existing.join("\n") + newest).digest("hex");
	if (reminded === fingerprint) return { block: false, fingerprint };
	return { block: true, fingerprint, why, files: existing };
}

export const validSkip = (skip, current) => Boolean(current && skip && skip.fingerprint === current.value && String(skip.reason ?? "").trim().length >= MIN_SKIP_REASON);

// "block" mode: keep the agent working until the evidence matches the code or it records why it cannot verify.
// With a session-start record, "changed" means the fingerprint moved since the session began, so committing the
// work does not hide it and files the human left dirty before the session are not blamed on the agent.
// Blocks are counted per session and reset on each new user turn (stop_hook_active false); after MAX_BLOCKS in
// a row the stop is released with a message to the human, so a stuck agent cannot loop forever.
export function decideBlock({ root, files, ignore, evidence, current, skip, state = {}, stopHookActive = false, sessionStart = null, againstOff = false }) {
	const relevant = relevantFiles(root, files, ignore);
	const next = { ...state, blocks: 0 };
	const tracked = Boolean(sessionStart?.fingerprint && current);
	const changed = tracked ? sessionStart.fingerprint !== current.value : relevant.length > 0;
	if (!changed) return { action: "allow", state: next };
	const why = staleReason(evidence, current, newestMtime(root, relevant), sessionStart, againstOff);
	if (!why) return { action: "allow", state: next };
	if (validSkip(skip, current)) {
		if (state.skipAnnounced === current.value) return { action: "allow", state: next };
		return { action: "release", state: { ...next, skipAnnounced: current.value }, message: `stack-agent: the agent stopped without verifying and recorded why in ${SKIP_FILE}: "${String(skip.reason).trim().slice(0, 300)}"` };
	}
	const dirty = sessionStart?.dirty;
	const own = dirty && current ? relevant.filter((f) => dirty[f] !== current.entries.get(f)) : relevant;
	const shown = own.length ? own : ["changes committed since the session started"];
	const blocks = (stopHookActive ? (state.blocks ?? 0) : 0) + 1;
	if (blocks > MAX_BLOCKS) {
		const list = shown.slice(0, 5).join(", ") + (shown.length > 5 ? ", ..." : "");
		return { action: "release", state: { ...state, blocks }, message: `stack-agent: stopping with unverified changes after ${MAX_BLOCKS} reminders (${list}). Run node .stack-agent/bin/verify.mjs before trusting this change.` };
	}
	return { action: "block", state: { ...state, blocks }, why, files: shown, attempt: blocks };
}

export function reminderMessage({ why, files, verifyConfigChanged, mode = "remind", attempt = 1 }) {
	const list = files.slice(0, 10).join(", ") + (files.length > 10 ? ", ..." : "");
	const addCheck = verifyConfigChanged
		? ""
		: `${VERIFY} has no new check in this change set. If the change adds or changes behavior a user can see, ` +
			`first add a check for it there (the success case and at least one rejection case), so the evidence covers ` +
			`the new behavior and not only the old checks. If nothing a user can see changed, say so. `;
	const ending =
		mode === "block"
			? `If verification truly cannot run here, record why with \`node .stack-agent/bin/verify.mjs --skip "<reason>"\` ` +
				`and tell the user the change is unverified. (Stop ${attempt} of ${MAX_BLOCKS}: stopping stays blocked until the evidence matches the code.)\n`
			: `This reminder fires once per change set.\n`;
	return (
		`stack-agent: code changed but ${why} (${list}). Before you finish, ${addCheck ? addCheck + "Then run" : "run"} ` +
		`the full verification (\`node .stack-agent/bin/verify.mjs\` with no flags, see the verify skill) and report ` +
		`its evidence file, or say plainly why it cannot run here. ${ending}`
	);
}

const readJsonOr = (file, fallback) => {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return fallback;
	}
};

export const sessionFile = (evidenceDir, sessionId) => path.join(evidenceDir, "sessions", `${String(sessionId ?? "default").replace(/[^\w-]/g, "_")}.json`);

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const input = readHookInput();
	const root = findUp(input.cwd ?? process.cwd(), VERIFY);
	const files = root ? changedFiles(root) : null;
	if (files) {
		const config = readJsonOr(path.join(root, VERIFY), {});
		const evidenceDir = path.resolve(root, config.evidenceDir ?? ".stack-agent/evidence");
		const stateFile = sessionFile(evidenceDir, input.session_id);
		const state = readJsonOr(stateFile, {});
		// settings come from the session-start snapshot when there is one, so editing verify.json mid-session
		// (stopHook "remind", stopHookIgnore ["**"]) cannot switch the hook off for the work in progress
		const settings = state.fingerprint ? state : config;
		const mode = settings.stopHook === "remind" ? "remind" : "block";
		const ignore = ignoreList(settings.stopHookIgnore);
		const againstOff = config.against === false;
		const latest = path.join(evidenceDir, "latest.json");
		let evidence = null;
		if (fs.existsSync(latest)) {
			const record = readJsonOr(latest, null);
			if (record) evidence = { ok: record.ok === true, full: record.full === true, fingerprint: record.fingerprint ?? null, ignore: record.ignore, against: record.against, changedByRun: record.changedByRun, mtimeMs: fs.statSync(latest).mtimeMs };
		}
		const current = codeFingerprint(root, { ignore, evidenceDir: config.evidenceDir ?? ".stack-agent/evidence" });
		const verifyConfigChanged = files.includes(VERIFY);
		if (mode === "remind") {
			if (!input.stop_hook_active) {
				const markerPath = path.join(evidenceDir, ".stop-reminded");
				const reminded = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : null;
				const verdict = decide({ root, files, ignore, evidence, reminded, current, againstOff });
				if (verdict.block) {
					fs.mkdirSync(evidenceDir, { recursive: true });
					fs.writeFileSync(markerPath, verdict.fingerprint);
					process.stderr.write(reminderMessage({ why: verdict.why, files: verdict.files, verifyConfigChanged }));
					process.exitCode = 2;
				}
			}
		} else {
			const skip = readJsonOr(path.join(root, SKIP_FILE), null);
			const verdict = decideBlock({ root, files, ignore, evidence, current, skip, state, stopHookActive: input.stop_hook_active === true, sessionStart: state.fingerprint ? state : null, againstOff });
			fs.mkdirSync(path.dirname(stateFile), { recursive: true });
			fs.writeFileSync(stateFile, JSON.stringify(verdict.state));
			if (verdict.action === "block") {
				process.stderr.write(reminderMessage({ why: verdict.why, files: verdict.files, verifyConfigChanged, mode, attempt: verdict.attempt }));
				process.exitCode = 2;
			} else if (verdict.action === "release") process.stdout.write(JSON.stringify({ systemMessage: verdict.message }));
		}
	}
}
