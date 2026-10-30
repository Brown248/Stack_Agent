#!/usr/bin/env node
// Runs NVIDIA SkillSpector (a static security scanner for agent skills) over what this plugin ships into a user's
// session: each skill, the agents, hooks.json, and the hook scripts. Static only (--no-llm), so no file leaves the
// machine. Known false positives live in .github/skillspector/<target>.baseline.json, each with its reason; a scan
// fails only on a finding no baseline covers. SkillSpector cannot apply a baseline to a multi-skill scan, so each
// skill is scanned on its own. Not vendored by init and not part of npm test: it needs Python and SkillSpector.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs } from "./lib/files.mjs";

const USAGE = `usage: node scripts/skill-scan.mjs [--root DIR] [--bin PATH] [--list]
  --root  the plugin to scan (default: this repo)
  --bin   the skillspector executable (default: $SKILLSPECTOR_BIN, else skillspector on PATH)
  --list  print the targets and their baselines, scan nothing
  --rebaseline KEY[,KEY]  after editing a skill's text, write its baseline again (the hash follows the text). Only when the
          findings are the same kinds, in the same files, and the same number as the baseline holds; anything else is refused, and each entry keeps
          its reason. Prints the findings it covers: read them, then check the diff.
exit codes: 0 no new finding, 1 a new finding, 2 usage error or a scan that could not run`;

const here = path.dirname(fileURLToPath(import.meta.url));

// [key, path relative to the root]; the key names the baseline file
export function targets(root) {
	const skillsDir = path.join(root, "skills");
	const skills = fs.existsSync(skillsDir)
		? fs
				.readdirSync(skillsDir, { withFileTypes: true })
				.filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, "SKILL.md")))
				.map((d) => [`skill-${d.name}`, `skills/${d.name}`])
				.sort()
		: [];
	const others = [
		["agents", "agents"],
		["hooks", "hooks"],
		["scripts-hooks", "scripts/hooks"],
	].filter(([, rel]) => fs.existsSync(path.join(root, rel)));
	return [...skills, ...others];
}

export function scanArgs(root, [key, rel]) {
	const args = ["scan", path.join(root, rel), "--no-llm", "--fail-on-findings"];
	const baseline = path.join(root, ".github", "skillspector", `${key}.baseline.json`);
	if (fs.existsSync(baseline)) args.push("--baseline", baseline);
	return { args, baseline: fs.existsSync(baseline) ? baseline : null };
}

// a .js/.mjs bin runs under this Node (the tests use that for a fake scanner)
function run(bin, argv) {
	const [cmd, pre] = /\.(mjs|cjs|js)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
	const r = spawnSync(cmd, [...pre, ...argv], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" }, maxBuffer: 64 * 1024 * 1024 });
	if (r.error) throw new ConfigError(`could not run ${bin}: ${r.error.code ?? r.error.message}`);
	return r;
}

// A skill's baseline holds a hash of its text, so every edit to the text changes it even when the known false positive
// is the same. This rewrites it, but only if the scan finds what the baseline already covers: the same rule ids in the
// same files, the same number of each. A finding in another file, or of another kind, is never absorbed this way. What
// the scanner writes is checked against that scan too, and each entry keeps the reason it had.
export function rebaseline(root, keys, bin) {
	if (!keys.length) throw new ConfigError("--rebaseline needs a target key, for example skill-verify (see --list)");
	const list = targets(root);
	const kind = (x) => `${x.file ?? x.location?.file ?? "?"}|${x.rule_id ?? x.id}`;
	const lines = [];
	let code = 0;
	try {
		for (const key of keys) {
			const target = list.find((t) => t[0] === key);
			if (!target) throw new ConfigError(`--rebaseline: no target ${key} (see --list)`);
			const file = path.join(root, ".github", "skillspector", `${key}.baseline.json`);
			if (!fs.existsSync(file)) throw new ConfigError(`--rebaseline: ${key} has no baseline; a first one is written by hand with its reason`);
			let old;
			try {
				old = JSON.parse(fs.readFileSync(file, "utf8"));
			} catch (err) {
				throw new ConfigError(`--rebaseline: cannot read ${path.relative(root, file)}: ${err.message}`);
			}
			if (!Array.isArray(old.fingerprints)) throw new ConfigError(`--rebaseline: ${path.relative(root, file)} has no fingerprints list`);
			const dir = path.join(root, target[1]);
			const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stack-agent-rebaseline-"));
			try {
				const scanned = path.join(tmp, "scan.json");
				run(bin, ["scan", dir, "--no-llm", "--format", "json", "--output", scanned]);
				if (!fs.existsSync(scanned)) throw new ConfigError(`--rebaseline: the scan of ${target[1]} wrote no result`);
				const issues = JSON.parse(fs.readFileSync(scanned, "utf8")).issues ?? [];
				const now = issues.map(kind).sort();
				const was = old.fingerprints.map(kind).sort();
				if (JSON.stringify(now) !== JSON.stringify(was)) {
					lines.push(`REFUSED      ${target[1]}: the scan finds [${now}] and the baseline holds [${was}] (file|rule); triage the difference first`);
					code = 1;
					continue;
				}
				const fresh = path.join(tmp, "baseline.json");
				const r = run(bin, ["baseline", dir, "--no-llm", "-o", fresh, "--reason", "rebaseline"]);
				if (r.status !== 0 || !fs.existsSync(fresh)) throw new ConfigError(`--rebaseline: the scanner could not write a baseline for ${target[1]} (exit ${r.status})`);
				const next = JSON.parse(fs.readFileSync(fresh, "utf8"));
				if (!Array.isArray(next.fingerprints) || JSON.stringify(next.fingerprints.map(kind).sort()) !== JSON.stringify(now)) {
					throw new ConfigError(`--rebaseline: the baseline the scanner wrote for ${target[1]} does not match its own scan; nothing was changed`);
				}
				// each entry keeps its reason, matched by file and rule id in order
				const reasons = new Map();
				for (const f of old.fingerprints) reasons.set(kind(f), [...(reasons.get(kind(f)) ?? []), f.reason]);
				for (const f of next.fingerprints) f.reason = reasons.get(kind(f))?.shift() ?? f.reason;
				fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
				const what = issues.map((i) => `${i.id ?? i.rule_id} in ${i.location?.file ?? "?"} line ${i.location?.start_line ?? "?"} ${JSON.stringify(i.finding ?? "")}`).join("; ");
				lines.push(`rebaselined  ${target[1]}${what ? `: ${what}` : ""}`);
			} finally {
				fs.rmSync(tmp, { recursive: true, force: true });
			}
		}
	} catch (err) {
		// say which targets were already rewritten before this one stopped the run
		if (err instanceof ConfigError && lines.length) err.message += `\n${lines.join("\n")}`;
		throw err;
	}
	return { code, text: lines.join("\n") };
}

export function main(argv) {
	const args = parseArgs(argv, { flags: ["list", "help"], options: ["root", "bin", "rebaseline"] });
	if (args.help) return { code: 0, text: USAGE };
	const root = path.resolve(args.root ?? path.join(here, ".."));
	const list = targets(root);
	if (!list.length) throw new ConfigError(`nothing to scan under ${root}`);
	if (args.list) return { code: 0, text: list.map((t) => `${t[1]}${scanArgs(root, t).baseline ? `  (baseline ${path.relative(root, scanArgs(root, t).baseline).replaceAll("\\", "/")})` : ""}`).join("\n") };
	const bin = args.bin ?? process.env.SKILLSPECTOR_BIN ?? "skillspector";
	if (args.rebaseline !== undefined) return rebaseline(root, String(args.rebaseline).split(",").map((k) => k.trim()).filter(Boolean), bin);
	const lines = [];
	let worst = 0;
	for (const t of list) {
		const r = run(bin, scanArgs(root, t).args);
		// SkillSpector: 0 clean, 1 an active finding (--fail-on-findings), anything else a scan that did not finish
		const verdict = r.status === 0 ? "ok" : r.status === 1 ? "NEW FINDING" : `ERROR (exit ${r.status})`;
		worst = Math.max(worst, r.status === 0 ? 0 : r.status === 1 ? 1 : 2);
		lines.push(`${verdict.padEnd(12)} ${t[1]}`);
		if (r.status !== 0) lines.push((r.stdout + r.stderr).trim().split("\n").slice(-40).map((l) => `    ${l}`).join("\n"));
	}
	lines.push(worst === 0 ? `skill-scan: ok (${list.length} target(s), known false positives in .github/skillspector/)` : worst === 1 ? "skill-scan: NEW FINDING, triage it: fix it, or add it to the target's baseline with the reason" : "skill-scan: a scan could not run");
	return { code: worst, text: lines.join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		(code === 0 ? console.log : console.error)(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`skill-scan: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
