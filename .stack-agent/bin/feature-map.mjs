#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs, readJson } from "./lib/files.mjs";

const USAGE = `usage: node feature-map.mjs [--root DIR] [--map FILE] [--draft] [--json]
  default  check the feature map against the code and the verify checks (drift check)
  --draft  print a map table with one row per verify check, for an agent to fill in and a human to review
  --map    the map file, relative to --root (default .stack-agent/feature-map.md)
exit codes: 0 in sync, 1 drift, 2 config error`;

export const DEFAULT_MAP = ".stack-agent/feature-map.md";
const HEADER = "| Feature | Where | How a user reaches it | Check |";

// "Where" holds one or more places, separated by commas: a repo path, path:line, or path#text, where text must
// appear in the file (a selector, a flag, a menu label), so the map fails when the code no longer has it
export function parsePlace(place) {
	const hash = place.indexOf("#");
	if (hash > 0) return { file: place.slice(0, hash).trim(), anchor: place.slice(hash + 1).trim() };
	const m = /^(.*?):(\d+)$/.exec(place);
	return m ? { file: m[1].trim(), line: Number(m[2]) } : { file: place.trim() };
}

const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/^`|`$/g, ""));
const list = (cell) => cell.split(",").map((s) => s.trim().replace(/^`|`$/g, "")).filter((s) => s && s !== "-");

export function parseFeatureMap(text) {
	const rows = [];
	let inTable = false;
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim().startsWith("|")) {
			inTable = false;
			continue;
		}
		const c = cells(line);
		if (/^feature$/i.test(c[0])) {
			inTable = true;
			continue;
		}
		if (!inTable || /^:?-+:?$/.test(c[0])) continue;
		rows.push({ feature: c[0], where: list(c[1] ?? "").filter((p) => p !== "TODO"), reach: c[2] ?? "", checks: list(c[3] ?? "").filter((p) => p !== "TODO"), raw: c });
	}
	return rows;
}

export function diffFeatureMap({ root, rows, checkNames }) {
	const problems = [];
	const warnings = [];
	const seen = new Set();
	for (const row of rows) {
		const name = row.feature || "(no name)";
		if (seen.has(name)) problems.push(`${name}: listed twice`);
		seen.add(name);
		if (!row.where.length) problems.push(`${name}: no place in the Where column`);
		for (const place of row.where) {
			const { file, line, anchor } = parsePlace(place);
			const abs = path.join(root, file);
			if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
				problems.push(`${name}: ${file} does not exist`);
				continue;
			}
			const text = line !== undefined || anchor !== undefined ? fs.readFileSync(abs, "utf8") : "";
			if (line !== undefined && line > text.split("\n").length) problems.push(`${name}: ${file} has no line ${line}`);
			if (anchor !== undefined && !text.includes(anchor)) problems.push(`${name}: ${file} no longer contains ${JSON.stringify(anchor)}`);
		}
		for (const check of row.checks) if (!checkNames.includes(check)) problems.push(`${name}: no verify check named ${check}`);
		if (!row.checks.length) warnings.push(`${name}: no verify check covers it`);
		if (row.raw.some((c) => /\bTODO\b/.test(c))) warnings.push(`${name}: still has TODO cells, a human has not reviewed it`);
	}
	return { problems, warnings };
}

export function draftFeatureMap(checks) {
	const lines = [HEADER, "| --- | --- | --- | --- |"];
	for (const c of checks) lines.push(`| ${c.name} | TODO | TODO | ${c.name} |`);
	return lines.join("\n");
}

function checksOf(root) {
	const file = path.join(root, ".stack-agent/verify.json");
	return fs.existsSync(file) ? (readJson(file, "verify config").checks ?? []).filter((c) => typeof c?.name === "string") : [];
}

export function main(argv) {
	const args = parseArgs(argv, { flags: ["draft", "json", "help"], options: ["root", "map"] });
	if (args.help) return { code: 0, text: USAGE };
	const root = path.resolve(args.root ?? process.cwd());
	const checks = checksOf(root);
	if (args.draft) return { code: 0, text: draftFeatureMap(checks) };
	const mapRel = args.map ?? DEFAULT_MAP;
	const mapFile = path.resolve(root, mapRel);
	if (!fs.existsSync(mapFile)) throw new ConfigError(`feature map not found: ${mapRel}. Create it from --draft first.`);
	const rows = parseFeatureMap(fs.readFileSync(mapFile, "utf8"));
	if (!rows.length) throw new ConfigError(`${mapRel} has no table with a "Feature" header row`);
	const { problems, warnings } = diffFeatureMap({ root, rows, checkNames: checks.map((c) => c.name) });
	if (args.json) return { code: problems.length ? 1 : 0, text: JSON.stringify({ ok: problems.length === 0, features: rows.length, problems, warnings }, null, 2) };
	const out = [...problems, ...warnings.map((w) => `  warning: ${w}`)];
	const covered = rows.filter((r) => r.checks.length).length;
	out.push(problems.length ? `feature-map: DRIFT (${problems.length} problem(s))` : `feature-map: ok (${rows.length} feature(s), ${covered} covered by verify checks)`);
	return { code: problems.length ? 1 : 0, text: out.join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		(code === 0 ? console.log : console.error)(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`feature-map: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
