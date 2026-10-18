#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesAny, toPosix } from "../lib/files.mjs";
import { findUp, readHookInput } from "./read-input.mjs";

const VERIFY = ".stack-agent/verify.json";
const DEFAULT_IGNORE = ["**/*.md", ".stack-agent/**", "docs/**"];

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

export function changedFiles(projectRoot) {
	const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: projectRoot, encoding: "utf8" });
	if (top.status !== 0) return null;
	const gitRoot = top.stdout.trim();
	const r = spawnSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: gitRoot, encoding: "utf8" });
	if (r.status !== 0) return null;
	return parsePorcelainZ(r.stdout)
		.map((p) => toPosix(path.relative(projectRoot, path.join(gitRoot, p))))
		.filter((p) => !p.startsWith("../") && !path.isAbsolute(p));
}

export function decide({ root, files, ignore, evidence, reminded }) {
	const relevant = files.filter((f) => !matchesAny(f, ignore));
	const existing = relevant.filter((f) => fs.existsSync(path.join(root, f)));
	if (existing.length === 0) return { block: false };
	const newest = Math.max(...existing.map((f) => fs.statSync(path.join(root, f)).mtimeMs));
	const fresh = evidence && evidence.ok && evidence.full && evidence.mtimeMs >= newest;
	if (fresh) return { block: false };
	const fingerprint = crypto.createHash("sha1").update(existing.join("\n") + newest).digest("hex");
	if (reminded === fingerprint) return { block: false, fingerprint };
	const why = !evidence
		? "there is no verify evidence yet"
		: !evidence.ok
			? "the latest verify run failed"
			: !evidence.full
				? "the latest verify run was partial (skipped steps, a --check filter, or --reuse)"
				: "files changed after the latest passing verify run";
	return { block: true, fingerprint, why, files: existing };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const input = readHookInput();
	const root = input.stop_hook_active ? null : findUp(input.cwd ?? process.cwd(), VERIFY);
	const files = root ? changedFiles(root) : null;
	if (files) {
		let config = {};
		try {
			config = JSON.parse(fs.readFileSync(path.join(root, VERIFY), "utf8"));
		} catch {}
		const evidenceDir = path.resolve(root, config.evidenceDir ?? ".stack-agent/evidence");
		const latest = path.join(evidenceDir, "latest.json");
		let evidence = null;
		if (fs.existsSync(latest)) {
			try {
				const record = JSON.parse(fs.readFileSync(latest, "utf8"));
				evidence = { ok: record.ok === true, full: record.full === true, mtimeMs: fs.statSync(latest).mtimeMs };
			} catch {}
		}
		const markerPath = path.join(evidenceDir, ".stop-reminded");
		const reminded = fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8").trim() : null;
		const verdict = decide({ root, files, ignore: config.stopHookIgnore ?? DEFAULT_IGNORE, evidence, reminded });
		if (verdict.block) {
			fs.mkdirSync(evidenceDir, { recursive: true });
			fs.writeFileSync(markerPath, verdict.fingerprint);
			const list = verdict.files.slice(0, 10).join(", ") + (verdict.files.length > 10 ? ", ..." : "");
			process.stderr.write(
				`stack-agent: code changed but ${verdict.why} (${list}). Before you finish, run the full verification ` +
					`(\`node .stack-agent/bin/verify.mjs\` with no flags, see the verify skill) and report its evidence file, ` +
					`or say plainly why it cannot run here. This reminder fires once per change set.\n`,
			);
			process.exitCode = 2;
		}
	}
}
