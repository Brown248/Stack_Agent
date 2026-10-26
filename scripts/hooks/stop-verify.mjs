#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baselineVersion, compareToBaseline, loadConfig, runGuard } from "../guard.mjs";
import { matchesAny } from "../lib/files.mjs";
import { FINGERPRINT_VERSION, SKIP_FILE, VERIFY_CONFIG as VERIFY, changedFiles, codeFingerprint, ignoreList, parsePorcelainZ } from "../lib/fingerprint.mjs";
import { findUp, readHookInput } from "./read-input.mjs";
import { readConfig, readStart, readState, recordLost, writeState } from "./session-record.mjs";

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
	// evidence without the field predates it and was computed the way version 1 computes it
	if (evidence.fingerprint && current && (evidence.fingerprintVersion ?? 1) !== FINGERPRINT_VERSION)
		return `the latest verify run was made by a .stack-agent/bin/verify.mjs that computes fingerprints differently (version ${evidence.fingerprintVersion ?? 1}, this hook uses ${FINGERPRINT_VERSION}), so its evidence can never match; refresh .stack-agent/bin with the plugin's init script, then run verify again`;
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

// E1: an agent that cannot run commands (no Node, a read-only sandbox) declares the skip as the last line of its
// final message; the hook, which runs outside the sandbox, records it. Only the last non-empty line counts, so
// quoting or explaining the marker earlier in the message does not trigger it.
export const SKIP_MARKER = "stack-agent-skip:";
export function markerReason(message) {
	const lines = String(message ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
	const m = /^stack-agent-skip:\s*(.*)$/i.exec(lines.at(-1) ?? "");
	return m ? m[1].trim() : null;
}

export const validSkip = (skip, current) => Boolean(current && skip && skip.fingerprint === current.value && String(skip.reason ?? "").trim().length >= MIN_SKIP_REASON);

// "block" mode: keep the agent working until the evidence matches the code or it records why it cannot verify.
// With a session-start record, "changed" means the fingerprint moved since the session began, so committing the
// work does not hide it and files the human left dirty before the session are not blamed on the agent.
// Blocks are counted per session and reset on each new user turn (stop_hook_active false); after MAX_BLOCKS in
// a row the stop is released with a message to the human, so a stuck agent cannot loop forever.
export function decideBlock({ root, files, ignore, evidence, current, skip, state = {}, stopHookActive = false, sessionStart = null, againstOff = false, lost = false, guardFailures = [] }) {
	const relevant = relevantFiles(root, files, ignore);
	const next = { ...state, blocks: 0 };
	const tracked = Boolean(sessionStart?.fingerprint && current);
	// a baseline this session took and that has since been removed: nothing tells what the agent changed, so assume it did
	const changed = lost || (tracked ? sessionStart.fingerprint !== current.value : relevant.length > 0);
	if (!changed) return { action: "allow", state: next };
	// Guard violations the session added, including through the shell, where the after-edit hook does not look. They
	// come first: fixing them changes the code, so any evidence would be stale anyway. A skip record does not cover
	// them (it says verification could not run, not that a rule may break); the block cap still applies.
	if (guardFailures.length) {
		const blocks = (stopHookActive ? (state.blocks ?? 0) : 0) + 1;
		if (blocks > MAX_BLOCKS)
			return { action: "release", state: { ...state, blocks }, message: `stack-agent: stopping with guard violations after ${MAX_BLOCKS} reminders: ${guardFailures.slice(0, 3).join("; ")}${guardFailures.length > 3 ? "; ..." : ""}. Fix them before trusting this change; CI will fail on them.` };
		return { action: "block", kind: "guard", state: { ...state, blocks }, violations: guardFailures, attempt: blocks };
	}
	const stale = staleReason(evidence, current, newestMtime(root, relevant), sessionStart, againstOff);
	// a removed record is worth a human's attention whatever else is going on
	// evidence that matches the current code still settles it
	const why = lost && stale ? `${stale}, and the session record under .stack-agent/evidence/sessions was removed` : stale;
	// Verified, but the against step could not show the change is tested: the changed tests import something the old
	// code lacks and no new check runs the program. Asked once per code state; stopping again after that is allowed,
	// since some changes have nothing a check can run.
	if (!why && evidence?.againstImportMissing && current && state.importAsked !== current.value)
		return { action: "block", kind: "import", state: { ...next, importAsked: current.value }, files: relevant };
	// Verified, but the code changed and no check or test is new, so nothing shows the change is tested. Asked once
	// per code state, like the import case: a refactor has nothing new to test, and the agent can say so.
	if (!why && evidence?.againstNoCoverage && current && state.coverageAsked !== current.value)
		return { action: "block", kind: "coverage", state: { ...next, coverageAsked: current.value }, files: relevant };
	if (!why) return { action: "allow", state: next };
	if (validSkip(skip, current)) {
		if (state.skipAnnounced === current.value) return { action: "allow", state: next, viaSkip: true };
		const where = skip.via === "message" && !skip.written ? "said why in its final message" : `recorded why in ${SKIP_FILE}`;
		return { action: "release", viaSkip: true, state: { ...next, skipAnnounced: current.value }, message: `stack-agent: the agent stopped without verifying and ${where}: "${String(skip.reason).trim().slice(0, 300)}"` };
	}
	const dirty = sessionStart?.dirty;
	const own = dirty && current ? relevant.filter((f) => dirty[f] !== current.entries.get(f)) : relevant;
	const shown = own.length ? own : [lost ? "the session record under .stack-agent/evidence/sessions was removed" : "changes committed since the session started"];
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
			? `If verification truly cannot run here, record why with \`node .stack-agent/bin/verify.mjs --skip "<reason>"\`, or, if you ` +
				`cannot run commands at all, end your final message with the line \`${SKIP_MARKER} <reason>\`; if the user asked you ` +
				`not to verify, say so in the reason, and tell the user the change is unverified. ` +
				`(Stop ${attempt} of ${MAX_BLOCKS}: stopping stays blocked until the evidence matches the code.)\n`
			: `This reminder fires once per change set.\n`;
	return (
		`stack-agent: code changed but ${why} (${list}). Before you finish, ${addCheck ? addCheck + "Then run" : "run"} ` +
		`the full verification (\`node .stack-agent/bin/verify.mjs\` with no flags, see the verify skill) and report ` +
		`its evidence file, or say plainly why it cannot run here. ${ending}`
	);
}

export function guardMessage(violations, attempt = 1) {
	return (
		`stack-agent: the guard fails on files changed in this session (the after-edit and after-shell hooks report a ` +
		`violation once, so one left unfixed gets here). Fix the code, following each fix line; never raise the baseline ` +
		`to get past it:\n` +
		violations.slice(0, 10).map((v) => `  ${v}`).join("\n") +
		(violations.length > 10 ? `\n  ... and ${violations.length - 10} more (run node .stack-agent/bin/guard.mjs)` : "") +
		`\nThen run the full verification again. (Stop ${attempt} of ${MAX_BLOCKS}.)\n`
	);
}

// The guard on the files this session changed (in the working tree, or committed since it started), compared with
// the baseline, as CI would. Files the human left dirty before the session and the agent did not touch are left out.
// Returns "file:line [rule] message; fix: ..." lines; empty when there is no guard config or it does not load.
export function sessionGuardFailures(root, { files, sessionStart = null, current = null }) {
	const configPath = path.join(root, ".stack-agent/guard.config.json");
	if (!fs.existsSync(configPath)) return [];
	const touched = new Set(files);
	if (sessionStart?.head) {
		const r = spawnSync("git", ["diff", "--name-only", "--relative", sessionStart.head, "HEAD"], { cwd: root, encoding: "utf8" });
		if (r.status === 0) for (const f of r.stdout.split("\n").filter(Boolean)) touched.add(f);
	}
	const dirty = sessionStart?.dirty;
	const own = [...touched].filter((f) => fs.existsSync(path.join(root, f)) && !(dirty && current && f in dirty && dirty[f] === current.entries.get(f)));
	if (!own.length) return [];
	try {
		const config = loadConfig(configPath);
		const baselinePath = path.resolve(root, config.baseline ?? ".stack-agent/guard-baseline.json");
		const baseline = fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : {};
		const violations = runGuard({ root, config, files: own });
		const { failing } = compareToBaseline(violations, baseline.counts ?? {}, own, fs.existsSync(baselinePath) ? baselineVersion(baseline) : undefined);
		const keys = new Set(failing.map((f) => `${f.rule}|${f.file}`));
		return violations.filter((v) => keys.has(`${v.rule}|${v.file}`)).map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}; fix: ${v.fix}`);
	} catch {
		return [];
	}
}

export function coverageMessage(files = []) {
	const list = files.slice(0, 5).join(", ") + (files.length > 5 ? ", ..." : "");
	return (
		`stack-agent: verification passed, but no check or test is new or changed while the code is${list ? ` (${list})` : ""}, ` +
		`so nothing shows that your change is tested: the against step had nothing to run on the code before it. If the ` +
		`change adds or changes behavior, add a test, or a check to ${VERIFY}, that fails without it (the success case and ` +
		"one rejection case), then run `node .stack-agent/bin/verify.mjs` again. If nothing a user can observe changed (a " +
		`refactor, a rename), say so in your final message and stop; this is asked once.\n`
	);
}

// names: what the tests imported that the old code lacks, when verify could read them from the test output
export function importMessage(names = []) {
	const name = names[0] ?? "<the new function>";
	const listed = names.length ? ` (${names.join(", ")})` : "";
	return (
		`stack-agent: verification passed, but its against step could not show that your change is tested: the changed tests ` +
		`import something the code before the change does not have${listed}, so on that code they fail before testing anything. ` +
		`Add a check to ${VERIFY} that fails without your change. If the program already runs the new code, run it the way a ` +
		`user does (a command or an HTTP request on an input that reaches it). If nothing calls the new code yet, call it ` +
		`directly with a command check, for example \`"args": ["node", "--input-type=module", "-e", "import { ${name} } from './src/<module>.js'; console.log(JSON.stringify(${name}(<input>)))"]\` ` +
		`or \`"args": ["python", "-c", "from <module> import ${name}; print(${name}(<input>))"]\`, with \`expectOutputIncludes\` set to the ` +
		`result you expect: on the code before your change it fails, and that is the proof. Then run \`node .stack-agent/bin/verify.mjs\` again. ` +
		`Only if the new code cannot be called at all, say why and stop; this is asked once.\n`
	);
}

const readJsonOr = (file, fallback) => {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return fallback;
	}
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const input = readHookInput();
	const root = findUp(input.cwd ?? process.cwd(), VERIFY);
	const files = root ? changedFiles(root) : null;
	if (files) {
		const config = readConfig(root);
		// E0: with a session record, the settings that decide what the hook checks (mode, ignore list, evidence
		// location, against) are the ones the session started with; editing verify.json mid-session changes nothing
		const start = readStart(root, input.session_id);
		const state = readState(root, input.session_id);
		const settings = start ?? config;
		const mode = settings.stopHook === "remind" ? "remind" : "block";
		const ignore = ignoreList(settings.stopHookIgnore);
		const evidenceRel = typeof settings.evidenceDir === "string" && settings.evidenceDir ? settings.evidenceDir : ".stack-agent/evidence";
		const evidenceDir = path.resolve(root, evidenceRel);
		const againstOff = start ? start.againstOff === true : config.against === false;
		const latest = path.join(evidenceDir, "latest.json");
		let evidence = null;
		if (fs.existsSync(latest)) {
			const record = readJsonOr(latest, null);
			const againstStep = Array.isArray(record?.steps) ? record.steps.find((s) => s?.step === "against") : null;
			if (record) evidence = { ok: record.ok === true, full: record.full === true, fingerprint: record.fingerprint ?? null, fingerprintVersion: record.fingerprintVersion, ignore: record.ignore, against: record.against, changedByRun: record.changedByRun, againstImportMissing: againstStep?.importMissing === true && Boolean(againstStep.skipped), againstNoCoverage: againstStep?.noNewCoverage === true && Boolean(againstStep.skipped), missingImports: Array.isArray(againstStep?.missingImports) ? againstStep.missingImports.filter((n) => typeof n === "string") : [], mtimeMs: fs.statSync(latest).mtimeMs };
		}
		const current = codeFingerprint(root, { ignore, evidenceDir: evidenceRel });
		const verifyConfigChanged = files.includes(VERIFY);
		if (mode === "remind") {
			if (!input.stop_hook_active) {
				const markerPath = path.join(evidenceDir, ".stop-reminded");
				const reminded = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : null;
				const verdict = decide({ root, files, ignore, evidence, reminded, current, againstOff });
				if (verdict.block) {
					try {
						fs.mkdirSync(evidenceDir, { recursive: true });
						fs.writeFileSync(markerPath, verdict.fingerprint);
					} catch {}
					process.stderr.write(reminderMessage({ why: verdict.why, files: verdict.files, verifyConfigChanged }));
					process.exitCode = 2;
				}
			}
		} else {
			let skip = readJsonOr(path.join(root, SKIP_FILE), null);
			const reason = markerReason(input.last_assistant_message);
			let shortMarker = false;
			if (reason !== null && current) {
				if (reason.length >= MIN_SKIP_REASON) {
					skip = { at: new Date().toISOString(), reason, fingerprint: current.value, via: "message", written: false };
				} else shortMarker = true;
			}
			const guardFailures = sessionGuardFailures(root, { files, sessionStart: start, current });
			const verdict = decideBlock({ root, files, ignore, evidence, current, skip, state, stopHookActive: input.stop_hook_active === true, sessionStart: start, againstOff, lost: !start && recordLost(root, input.session_id), guardFailures });
			// the hook runs outside any sandbox, so it can keep the agent's declared skip where reviewers see it
			if (skip?.via === "message" && verdict.viaSkip) {
				try {
					const { written, ...record } = skip;
					fs.writeFileSync(path.join(root, SKIP_FILE), JSON.stringify(record, null, 2) + "\n");
					if (verdict.message) verdict.message = verdict.message.replace("said why in its final message", `recorded why in ${SKIP_FILE}`);
				} catch {}
			}
			writeState(root, input.session_id, verdict.state);
			if (verdict.action === "block" && verdict.kind === "import") {
				process.stderr.write(importMessage(evidence?.missingImports));
				process.exitCode = 2;
			} else if (verdict.action === "block" && verdict.kind === "coverage") {
				process.stderr.write(coverageMessage(verdict.files));
				process.exitCode = 2;
			} else if (verdict.action === "block" && verdict.kind === "guard") {
				process.stderr.write(guardMessage(verdict.violations, verdict.attempt));
				process.exitCode = 2;
			} else if (verdict.action === "block") {
				const note = shortMarker ? `Your ${SKIP_MARKER} line needs a reason of at least ${MIN_SKIP_REASON} characters saying why verification cannot run. ` : "";
				process.stderr.write(note + reminderMessage({ why: verdict.why, files: verdict.files, verifyConfigChanged, mode, attempt: verdict.attempt }));
				process.exitCode = 2;
			} else if (verdict.action === "release") process.stdout.write(JSON.stringify({ systemMessage: verdict.message }));
		}
	}
}
