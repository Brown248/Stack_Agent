#!/usr/bin/env node
// Summarizes A/B run transcripts: skills invoked, Stop-hook feedback and where it landed relative to the
// first verify.json edit, verify.mjs runs, and files edited.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ConfigError, parseArgs } from "../lib/files.mjs";
import { summarizeTranscript } from "./lib.mjs";

const USAGE = `usage: node scripts/ab/inspect.mjs PATH [PATH ...] [--json]
  PATH  a transcript (.jsonl) or a folder of them (an A/B out dir's runs/ folder)
exit codes: 0 done, 2 usage error`;

export function collect(paths) {
	const files = [];
	for (const p of paths) {
		if (!fs.existsSync(p)) throw new ConfigError(`${p} does not exist`);
		if (fs.statSync(p).isDirectory()) files.push(...fs.readdirSync(p).filter((f) => f.endsWith(".jsonl")).sort().map((f) => path.join(p, f)));
		else files.push(p);
	}
	return files;
}

export function format(file, s) {
	const lines = [`\n== ${path.basename(file)}`];
	lines.push(`  skills: ${s.skills.join(", ") || "none"}`);
	lines.push(`  stop-hook feedback: ${s.feedback.length}${s.feedback.map((f) => `\n    ${f.position}: ${f.firstLine}`).join("")}`);
	lines.push(`  verify runs: ${s.verifyRuns.join(" ;; ") || "none"}`);
	lines.push(`  edited: ${s.edited.join(", ") || "none"}`);
	if (s.usage.cost !== null) lines.push(`  cost: $${s.usage.cost} in ${s.usage.turns} turns`);
	return lines.join("\n");
}

export function main(argv) {
	const args = parseArgs(argv, { flags: ["json"] });
	if (!args._.length) throw new ConfigError("give at least one transcript or folder");
	const files = collect(args._);
	const summaries = files.map((f) => ({ file: f, ...summarizeTranscript(fs.readFileSync(f, "utf8")) }));
	if (args.json) console.log(JSON.stringify(summaries, null, 2));
	else for (const s of summaries) console.log(format(s.file, s));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	try {
		main(process.argv.slice(2));
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
