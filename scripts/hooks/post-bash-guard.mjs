#!/usr/bin/env node
// After a shell command: the guard on the files that changed outside the edit tools since the last check, so a
// `sed -i`, a codemod, or a generator gets the same feedback right away that an Edit gets. Files are compared by git
// blob id with what the guard hooks last saw (the files left dirty when the session started, then each check, and
// each file the after-edit hook checked), so a violation is reported once, after the command that made it. The Stop
// hook and CI still check every changed file.
import fs from "node:fs";
import path from "node:path";
import { baselineVersion, compareToBaseline, loadConfig, runGuard } from "../guard.mjs";
import { ConfigError, readJson } from "../lib/files.mjs";
import { changedFiles } from "../lib/fingerprint.mjs";
import { findUp, readHookInput } from "./read-input.mjs";
import { blobIds, readSeen, writeSeen } from "./session-record.mjs";

const CONFIG = ".stack-agent/guard.config.json";
// past this many changed files (a checkout, an install into a tracked folder) the check is left to the Stop hook
const MAX_FILES = 2000;

const input = readHookInput();
const root = findUp(input.cwd ?? process.cwd(), CONFIG);
const changed = root ? (changedFiles(root) ?? []).filter((f) => !f.startsWith(".stack-agent/evidence/")) : [];
if (root && changed.length <= MAX_FILES) {
	const files = changed.filter((f) => {
		try {
			return fs.statSync(path.join(root, f)).isFile();
		} catch {
			return false;
		}
	});
	const ids = blobIds(root, files);
	const seen = readSeen(root, input.session_id);
	const fresh = files.filter((f) => ids.has(f) && seen[f] !== ids.get(f));
	writeSeen(root, input.session_id, { ...seen, ...Object.fromEntries(ids) });
	if (fresh.length) {
		try {
			const loaded = loadConfig(path.join(root, CONFIG));
			const config = { ...loaded, rules: loaded.rules.filter((r) => r.onEdit !== "skip") };
			const baselinePath = path.resolve(root, config.baseline ?? ".stack-agent/guard-baseline.json");
			const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath, "guard baseline") : {};
			const violations = runGuard({ root, config, files: fresh });
			const { failing } = compareToBaseline(violations, baseline.counts ?? {}, fresh, fs.existsSync(baselinePath) ? baselineVersion(baseline) : undefined);
			if (failing.length) {
				const keys = new Set(failing.map((f) => `${f.rule}|${f.file}`));
				const lines = violations
					.filter((v) => keys.has(`${v.rule}|${v.file}`))
					.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}\n  found: ${v.detail}\n  fix: ${v.fix}`);
				process.stderr.write(`stack-agent guard: that command changed files that now break rules. Fix them now, in the code; never raise the baseline.\n${lines.join("\n")}\n`);
				process.exitCode = 2;
			}
		} catch (err) {
			if (!(err instanceof ConfigError)) throw err;
			process.stderr.write(`stack-agent guard: config error: ${err.message}\n`);
			process.exitCode = 1;
		}
	}
}
