#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, matchesAny, parseArgs, readJson, requireStringArray, walk } from "./lib/files.mjs";
import { checkType } from "./verify.mjs";

const USAGE = `usage: node api-map.mjs [--root DIR] [--config FILE] [--draft] [--json]
  default  compare the API map with the routes found in code (drift check)
  --draft  print a map table generated from code, for an agent to fill in and a human to review
exit codes: 0 in sync, 1 drift, 2 config error`;

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function loadMapConfig(file) {
	const config = readJson(file, "api-map config");
	if (!config.map) throw new ConfigError("api-map config needs map (path of the markdown map)");
	if (!Array.isArray(config.sources) || !config.sources.length) throw new ConfigError("api-map config needs sources[]");
	requireStringArray(config.ignore, "ignore", { optional: true });
	for (const s of config.sources) {
		requireStringArray(s.files, "sources[].files");
		if (!s.pattern || typeof s.pattern !== "string") throw new ConfigError("each source needs a pattern string");
		if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s.pattern)) throw new ConfigError('source pattern contains a control character; in JSON a regex \\b must be written "\\\\b"');
		try {
			s.regex = new RegExp(s.pattern, "gm");
		} catch (err) {
			throw new ConfigError(`bad source pattern: ${err.message}`);
		}
		if (s.method !== undefined) {
			if (typeof s.method !== "string" || !METHODS.includes(s.method.toUpperCase())) throw new ConfigError(`source method must be one of ${METHODS.join(", ")}`);
			s.pathGroup ??= 1;
		} else {
			s.methodGroup ??= 1;
			s.pathGroup ??= 2;
		}
	}
	return config;
}

export function routesFromCode(root, config, warnings = []) {
	const files = walk(root, config.ignore);
	const routes = [];
	for (const source of config.sources) {
		const matched = files.filter((f) => matchesAny(f, source.files));
		if (matched.length === 0) warnings.push(`source ${JSON.stringify(source.files)} matches no files; check its globs`);
		for (const rel of matched) {
			const text = fs.readFileSync(path.join(root, rel), "utf8");
			source.regex.lastIndex = 0;
			for (let m; (m = source.regex.exec(text)); ) {
				if (m[0] === "") source.regex.lastIndex++;
				const method = source.method ?? m[source.methodGroup];
				const routePath = m[source.pathGroup];
				if (typeof method !== "string" || typeof routePath !== "string")
					throw new ConfigError(source.method ? `source pattern must capture the path in group ${source.pathGroup} (match in ${rel})` : `source pattern must capture the method in group ${source.methodGroup} and the path in group ${source.pathGroup} (match in ${rel})`);
				const line = text.slice(0, m.index).split("\n").length;
				routes.push({ method: method.toUpperCase(), path: routePath, file: rel, line });
			}
		}
	}
	return routes;
}

export function parseMap(text) {
	const rows = [];
	for (const line of text.split("\n")) {
		if (!line.trim().startsWith("|")) continue;
		const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/^`|`$/g, ""));
		if (!METHODS.includes(cells[0]?.toUpperCase())) continue;
		rows.push({ method: cells[0].toUpperCase(), path: cells[1], handler: cells[2] ?? "", calls: cells[3] ?? "", owner: cells[4] ?? "" });
	}
	return rows;
}

function routeRegex(routePath) {
	const escaped = routePath.replace(/[.+?^$()|[\]\\]/g, "\\$&");
	return new RegExp("^" + escaped.replace(/:[A-Za-z_]\w*|\{[^}]+\}/g, "[^/]+") + "$");
}

export function diffMap({ root, routes, rows, checks }) {
	const key = (r) => `${r.method} ${r.path}`;
	const inCode = new Map(routes.map((r) => [key(r), r]));
	const inMap = new Map(rows.map((r) => [key(r), r]));
	const missingFromMap = routes.filter((r) => !inMap.has(key(r)));
	const staleInMap = rows.filter((r) => !inCode.has(key(r)));
	const badHandler = rows.filter((r) => !r.handler || !fs.existsSync(path.join(root, r.handler.split(":")[0])));
	const httpChecks = checks.filter((c) => checkType(c) === "http" && typeof c.method === "string" && typeof c.path === "string");
	const unverified = routes.filter((r) => !httpChecks.some((c) => c.method.toUpperCase() === r.method && routeRegex(r.path).test(c.path.split("?")[0])));
	return { missingFromMap, staleInMap, badHandler, unverified };
}

function draftTable(routes) {
	const lines = ["| Method | Path | Handler | Calls | Owner |", "| --- | --- | --- | --- | --- |"];
	for (const r of routes) lines.push(`| ${r.method} | ${r.path} | ${r.file}:${r.line} | TODO | TODO |`);
	return lines.join("\n");
}

function main(argv) {
	const args = parseArgs(argv, { flags: ["draft", "json", "help"], options: ["root", "config"] });
	if (args.help) return { code: 0, text: USAGE };
	const root = path.resolve(args.root ?? process.cwd());
	const config = loadMapConfig(path.resolve(root, args.config ?? ".stack-agent/api-map.json"));
	const warnings = [];
	const routes = routesFromCode(root, config, warnings);
	if (args.draft) return { code: 0, text: draftTable(routes) };

	const mapFile = path.resolve(root, config.map);
	if (!fs.existsSync(mapFile)) throw new ConfigError(`map file not found: ${config.map}. Create it from --draft first.`);
	const rows = parseMap(fs.readFileSync(mapFile, "utf8"));
	const verifyFile = path.resolve(root, config.verifyConfig ?? ".stack-agent/verify.json");
	const checks = fs.existsSync(verifyFile) ? (readJson(verifyFile, "verify config").checks ?? []) : [];
	const diff = diffMap({ root, routes, rows, checks });
	const drift = diff.missingFromMap.length + diff.staleInMap.length + diff.badHandler.length;
	if (args.json) return { code: drift ? 1 : 0, text: JSON.stringify({ ok: drift === 0, routes: routes.length, ...diff }, null, 2) };

	const out = [];
	for (const r of diff.missingFromMap) out.push(`missing from map: ${r.method} ${r.path} (defined at ${r.file}:${r.line})`);
	for (const r of diff.staleInMap) out.push(`stale in map: ${r.method} ${r.path} (no route in code)`);
	for (const r of diff.badHandler) out.push(`bad handler path in map: ${r.method} ${r.path} -> ${JSON.stringify(r.handler)}`);
	for (const r of diff.unverified) out.push(`  warning: no verify check covers ${r.method} ${r.path}`);
	for (const r of rows.filter((x) => /\bTODO\b/.test(`${x.calls} ${x.owner}`))) out.push(`  warning: ${r.method} ${r.path} still has TODO cells, a human has not reviewed it`);
	for (const w of warnings) out.push(`  warning: ${w}`);
	out.push(drift ? `api-map: DRIFT (${drift} problem(s))` : `api-map: ok (${routes.length} route(s) mapped, ${routes.length - diff.unverified.length} covered by verify checks)`);
	return { code: drift ? 1 : 0, text: out.join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		(code === 0 ? console.log : console.error)(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`api-map: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}

export { main };
