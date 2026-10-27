#!/usr/bin/env node
// After a shell command: the guard on the files that changed outside the edit tools since the last check, so a
// `sed -i`, a codemod, or a generator gets the same feedback right away that an Edit gets. Files are compared by git
// blob id with what the guard hooks last saw (the files left dirty when the session started, then each check, and
// each file the after-edit hook checked), so a violation is reported once, after the command that made it. The Stop
// hook and CI still check every changed file.
//
// The changed files are read for the whole git repository and each is checked by the project it belongs to (the
// nearest folder above it with a guard config), so a command run from the top of a monorepo still reaches the
// projects inside it.
import fs from "node:fs";
import path from "node:path";
import { baselineVersion, compareToBaseline, loadConfig, runGuard } from "../guard.mjs";
import { ConfigError, readJson, toPosix } from "../lib/files.mjs";
import { changedFiles, gitTop } from "../lib/fingerprint.mjs";
import { findUp, readHookInput } from "./read-input.mjs";
import { blobIds, noteReport, readSeen, seenLogOffset, writeSeen } from "./session-record.mjs";

const CONFIG = ".stack-agent/guard.config.json";
// past this many changed files (a checkout, an install into a tracked folder) the check is left to the Stop hook
const MAX_FILES = 2000;

const input = readHookInput();
const cwd = path.resolve(input.cwd ?? process.cwd());
const top = gitTop(cwd);
const changed = top ? (changedFiles(top) ?? []) : [];
const failures = [];
if (changed.length <= MAX_FILES) {
	// project root -> its changed files, relative to that root
	const byRoot = new Map();
	const rootOf = new Map();
	for (const rel of changed) {
		const abs = path.join(top, rel);
		const dir = path.dirname(abs);
		if (!rootOf.has(dir)) rootOf.set(dir, findUp(dir, CONFIG));
		const root = rootOf.get(dir);
		if (!root) continue;
		const own = toPosix(path.relative(root, abs));
		if (own.startsWith(".stack-agent/evidence/")) continue;
		try {
			if (!fs.statSync(abs).isFile()) continue;
		} catch {
			continue;
		}
		if (!byRoot.has(root)) byRoot.set(root, []);
		byRoot.get(root).push(own);
	}
	for (const [root, files] of byRoot) {
		const offset = seenLogOffset(root, input.session_id);
		const seen = readSeen(root, input.session_id);
		const ids = blobIds(root, files);
		const fresh = files.filter((f) => ids.has(f) && seen[f] !== ids.get(f));
		writeSeen(root, input.session_id, { ...seen, ...Object.fromEntries(ids) }, offset);
		if (fresh.length) check(root, fresh);
	}
}
if (failures.length) {
	process.stderr.write(`stack-agent guard: that command changed files that now break rules. Fix them now, in the code; never raise the baseline.\n${failures.join("\n")}\n`);
	process.exitCode = 2;
}

function check(root, fresh) {
	const prefix = toPosix(path.relative(cwd, root));
	const shown = (file) => (prefix && !prefix.startsWith("..") ? `${prefix}/${file}` : file);
	try {
		const loaded = loadConfig(path.join(root, CONFIG));
		const config = { ...loaded, rules: loaded.rules.filter((r) => r.onEdit !== "skip") };
		const baselinePath = path.resolve(root, config.baseline ?? ".stack-agent/guard-baseline.json");
		const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath, "guard baseline") : {};
		const violations = runGuard({ root, config, files: fresh });
		const { failing } = compareToBaseline(violations, baseline.counts ?? {}, fresh, fs.existsSync(baselinePath) ? baselineVersion(baseline) : undefined);
		const keys = new Set(failing.map((f) => `${f.rule}|${f.file}`));
		const reported = violations.filter((v) => keys.has(`${v.rule}|${v.file}`));
		if (reported.length) noteReport(root, input.session_id, reported.map((v) => ({ file: v.file, line: v.line, rule: v.rule })));
		for (const v of reported) failures.push(`${shown(v.file)}:${v.line} [${v.rule}] ${v.message}\n  found: ${v.detail}\n  fix: ${v.fix}`);
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		process.stderr.write(`stack-agent guard: config error in ${shown(CONFIG)}: ${err.message}\n`);
		process.exitCode = 1;
	}
}
