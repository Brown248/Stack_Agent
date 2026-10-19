#!/usr/bin/env node
// Times guard.mjs on a synthetic repo. Not part of npm test and not vendored by init.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs } from "./lib/files.mjs";

const USAGE = `usage: node scripts/bench-guard.mjs [--files N] [--runs N] [--guard FILE] [--keep]
  builds N JS files (default 5000) under src/modules/*/ with the backend-http guard config,
  prints the median of --runs (default 3) full scans and one-file scans, then deletes the repo
  --guard  the guard.mjs to time (default: the one next to this script)
  --keep   leave the synthetic repo on disk and print its path`;

const here = path.dirname(fileURLToPath(import.meta.url));
const FILES_PER_MODULE = 50;

function line(i, mod, n) {
	if (i === 0) return `import { helper } from "./helper.js";`;
	if (i === 1) return `import { api } from "../m${(mod + 1) % n}/index.js";`;
	if (i === 2) return `const db = require("../../db");`;
	if (i % 9 === 0) return `// note ${i}: keep "quotes" and /* markers */ in comments`;
	if (i % 7 === 0) return `/* block ${i} */ const s${i} = "a string with // not a comment";`;
	return `export function f${i}(x) { return helper(x) + api(${i}) + \`t\${x}\`; }`;
}

export function buildRepo(dir, files) {
	const modules = Math.max(1, Math.ceil(files / FILES_PER_MODULE));
	const write = (rel, text) => {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), text);
	};
	fs.mkdirSync(path.join(dir, ".stack-agent"), { recursive: true });
	fs.copyFileSync(path.join(here, "..", "templates/presets/backend-http/guard.config.json"), path.join(dir, ".stack-agent/guard.config.json"));
	write("src/db.js", "export const db = {};\n");
	let made = 0;
	for (let m = 0; m < modules && made < files; m++) {
		write(`src/modules/m${m}/index.js`, `export const api = (x) => x;\n`);
		write(`src/modules/m${m}/helper.js`, `export const helper = (x) => x;\n`);
		for (let f = 0; f < FILES_PER_MODULE && made < files; f++, made++) {
			const lines = Array.from({ length: 40 }, (_, i) => line(i, m, modules));
			// 1 file in 100 reaches into another module's internals, so the scan has real violations to report
			if (made % 100 === 0) lines[3] = `import { x } from "../m${(m + 1) % modules}/helper.js";`;
			write(`src/modules/m${m}/file${f}.js`, lines.join("\n") + "\n");
		}
	}
	return `src/modules/m0/file1.js`;
}

function time(guard, args) {
	const start = process.hrtime.bigint();
	const r = spawnSync(process.execPath, [guard, ...args], { encoding: "utf8", maxBuffer: 1 << 30 });
	const ms = Number(process.hrtime.bigint() - start) / 1e6;
	if (r.status !== 0 && r.status !== 1) throw new Error(`guard exited ${r.status}: ${r.stderr}`);
	return { ms, digest: crypto.createHash("sha256").update(`${r.status}\n${r.stdout}\n${r.stderr}`).digest("hex").slice(0, 12) };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function main(argv) {
	const args = parseArgs(argv, { flags: ["keep", "help"], options: ["files", "runs", "guard"] });
	if (args.help) return USAGE;
	const files = Number(args.files ?? 5000);
	const runs = Number(args.runs ?? 3);
	if (!Number.isInteger(files) || files < 1 || !Number.isInteger(runs) || runs < 1) throw new ConfigError("--files and --runs must be positive integers");
	const guard = path.resolve(args.guard ?? path.join(here, "guard.mjs"));
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-agent-bench-"));
	try {
		const one = buildRepo(dir, files);
		const full = Array.from({ length: runs }, () => time(guard, ["--root", dir]));
		const single = Array.from({ length: runs }, () => time(guard, ["--root", dir, "--files", one]));
		const ms = (rs) => rs.map((r) => r.ms.toFixed(0)).join(", ");
		return [
			`guard bench: ${files} files, ${runs} runs each, node ${process.version}, ${guard}`,
			`  full scan     median ${median(full.map((r) => r.ms)).toFixed(0)} ms  (${ms(full)})  output ${full[0].digest}`,
			`  one-file scan median ${median(single.map((r) => r.ms)).toFixed(0)} ms  (${ms(single)})  output ${single[0].digest}`,
			args.keep ? `  repo kept at ${dir}` : null,
		].filter(Boolean).join("\n");
	} finally {
		if (!args.keep) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		console.log(main(process.argv.slice(2)));
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`bench-guard: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
