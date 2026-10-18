#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs, toPosix } from "./lib/files.mjs";

const USAGE = `usage: node init.mjs [TARGET_DIR] [--check]
  copies the Stack Agent tools into TARGET_DIR/.stack-agent/bin (refreshed on every run),
  adds config templates and a CI workflow only where none exist, and ignores the evidence dir.
  --check  only report setup that is still unfinished (EDIT ME placeholders, missing files)
exit codes: 0 done / setup complete, 1 setup still has placeholders, 2 usage error`;

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const TOOLS = ["guard.mjs", "verify.mjs", "api-map.mjs", "lib/files.mjs"];
const TEMPLATES = [
	["templates/.stack-agent/guard.config.json", ".stack-agent/guard.config.json"],
	["templates/.stack-agent/verify.json", ".stack-agent/verify.json"],
	["templates/.stack-agent/api-map.json", ".stack-agent/api-map.json"],
	["templates/.stack-agent/rules.md", ".stack-agent/rules.md"],
	["templates/.stack-agent/rules-table.md", ".stack-agent/rules-table.md"],
	["templates/ci/stack-agent.yml", ".github/workflows/stack-agent.yml"],
];
const GITIGNORE_LINE = ".stack-agent/evidence/";

export function pendingSetup(target) {
	const pending = [];
	for (const [, dest] of TEMPLATES) {
		const abs = path.join(target, dest);
		if (!fs.existsSync(abs)) pending.push(`${dest}: missing`);
		else if (fs.readFileSync(abs, "utf8").includes("EDIT ME")) pending.push(`${dest}: still has EDIT ME placeholders`);
	}
	if (!fs.existsSync(path.join(target, ".stack-agent/api-map.md"))) pending.push(".stack-agent/api-map.md: missing, create it with `node .stack-agent/bin/api-map.mjs --draft`");
	if (!fs.existsSync(path.join(target, ".stack-agent/guard-baseline.json"))) pending.push(".stack-agent/guard-baseline.json: missing, record existing violations with `node .stack-agent/bin/guard.mjs --update-baseline`");
	return pending;
}

export function init(target) {
	const report = [];
	for (const tool of TOOLS) {
		const dest = path.join(target, ".stack-agent/bin", tool);
		const src = fs.readFileSync(path.join(pluginRoot, "scripts", tool));
		const existed = fs.existsSync(dest);
		const same = existed && Buffer.compare(fs.readFileSync(dest), src) === 0;
		if (!same) {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.writeFileSync(dest, src);
		}
		report.push(`${same ? "unchanged" : existed ? "updated  " : "created  "} .stack-agent/bin/${tool}`);
	}
	for (const [src, dest] of TEMPLATES) {
		const abs = path.join(target, dest);
		if (fs.existsSync(abs)) {
			report.push(`kept     ${dest} (already exists, not overwritten)`);
			continue;
		}
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.copyFileSync(path.join(pluginRoot, src), abs);
		report.push(`created  ${dest}`);
	}
	const gitignore = path.join(target, ".gitignore");
	const current = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
	const ignoresEvidence = current.split(/\r?\n/).some((l) => ["/.stack-agent/evidence", ".stack-agent/evidence", ".stack-agent/evidence/**"].includes(l.trim().replace(/\/$/, "")) || l.trim() === "/.stack-agent/evidence/");
	if (ignoresEvidence) report.push("kept     .gitignore (evidence dir already ignored)");
	else {
		fs.writeFileSync(gitignore, current + (current && !current.endsWith("\n") ? "\n" : "") + GITIGNORE_LINE + "\n");
		report.push("updated  .gitignore (+ .stack-agent/evidence/)");
	}
	return report;
}

function main(argv) {
	const args = parseArgs(argv, { flags: ["check", "help"] });
	if (args.help) return { code: 0, text: USAGE };
	if (args._.length > 1) throw new ConfigError("give at most one target directory");
	const target = path.resolve(args._[0] ?? process.cwd());
	if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new ConfigError(`target is not a directory: ${target}`);
	if (path.resolve(target) === pluginRoot) throw new ConfigError("target is the Stack Agent repo itself; run this inside the backend repo");
	const lines = args.check ? [] : init(target);
	const pending = pendingSetup(target);
	lines.push(pending.length ? `\nsetup unfinished in ${toPosix(target)}:\n${pending.map((p) => "  - " + p).join("\n")}` : `\nsetup complete in ${toPosix(target)}`);
	return { code: args.check && pending.length ? 1 : 0, text: lines.join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		console.log(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`init: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
