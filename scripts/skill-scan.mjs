#!/usr/bin/env node
// Runs NVIDIA SkillSpector (a static security scanner for agent skills) over what this plugin ships into a user's
// session: each skill, the agents, hooks.json, and the hook scripts. Static only (--no-llm), so no file leaves the
// machine. Known false positives live in .github/skillspector/<target>.baseline.json, each with its reason; a scan
// fails only on a finding no baseline covers. SkillSpector cannot apply a baseline to a multi-skill scan, so each
// skill is scanned on its own. Not vendored by init and not part of npm test: it needs Python and SkillSpector.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs } from "./lib/files.mjs";

const USAGE = `usage: node scripts/skill-scan.mjs [--root DIR] [--bin PATH] [--list]
  --root  the plugin to scan (default: this repo)
  --bin   the skillspector executable (default: $SKILLSPECTOR_BIN, else skillspector on PATH)
  --list  print the targets and their baselines, scan nothing
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

export function main(argv) {
	const args = parseArgs(argv, { flags: ["list", "help"], options: ["root", "bin"] });
	if (args.help) return { code: 0, text: USAGE };
	const root = path.resolve(args.root ?? path.join(here, ".."));
	const list = targets(root);
	if (!list.length) throw new ConfigError(`nothing to scan under ${root}`);
	if (args.list) return { code: 0, text: list.map((t) => `${t[1]}${scanArgs(root, t).baseline ? `  (baseline ${path.relative(root, scanArgs(root, t).baseline).replaceAll("\\", "/")})` : ""}`).join("\n") };
	const bin = args.bin ?? process.env.SKILLSPECTOR_BIN ?? "skillspector";
	const lines = [];
	let worst = 0;
	for (const t of list) {
		// a .js/.mjs bin runs under this Node (the tests use that for a fake scanner)
		const [cmd, pre] = /\.(mjs|cjs|js)$/i.test(bin) ? [process.execPath, [bin]] : [bin, []];
		const r = spawnSync(cmd, [...pre, ...scanArgs(root, t).args], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" }, maxBuffer: 64 * 1024 * 1024 });
		if (r.error) throw new ConfigError(`could not run ${bin}: ${r.error.code ?? r.error.message}`);
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
