#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ConfigError, matchesAny, parseArgs, readJson, requireStringArray, toPosix, walk } from "./lib/files.mjs";

const USAGE = `usage: node guard.mjs [--root DIR] [--config FILE] [--files F...] [--json] [--strict]
                     [--update-baseline [--allow-increase]] [--compare-ref GIT_REF]
  --compare-ref  also fail if the baseline grew or a rule was removed compared with GIT_REF (use in CI)
exit codes: 0 clean, 1 violations (or baseline would increase), 2 config error`;

const RULE_TYPES = ["pattern", "forbidden-import", "module-boundary"];
const RESOLVE_EXT = ["", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", "/index.js", "/index.ts", "/index.mjs"];
const IMPORT_RES = [
	/\b(?:import|export)\s+(?:[^'"`;]*?\sfrom\s+)?(['"])([^'"]+)\1/g,
	/\b(?:require|import)\s*\(\s*(['"`])([^'"`$]+)\1\s*\)/g,
];
const ALLOW_RE = /stack-agent-allow\s+([\w-]+)((?:\s+\w+=(?:"[^"]*"|\S+))*)/;
const DEFAULT_MAX_ALLOW_DAYS = 90;

export function loadConfig(configPath) {
	const config = readJson(configPath, "guard config");
	if (!Array.isArray(config.rules) || config.rules.length === 0) throw new ConfigError("guard config needs a non-empty rules array");
	requireStringArray(config.ignore, "ignore", { optional: true });
	if (config.aliases !== undefined && (typeof config.aliases !== "object" || Array.isArray(config.aliases) || !Object.values(config.aliases).every((v) => typeof v === "string")))
		throw new ConfigError('aliases must map an import prefix to a repo path, e.g. {"@/": "src/"}');
	config.maxAllowDays ??= DEFAULT_MAX_ALLOW_DAYS;
	if (!Number.isInteger(config.maxAllowDays) || config.maxAllowDays < 1) throw new ConfigError("maxAllowDays must be a positive integer");
	const seen = new Set();
	for (const rule of config.rules) {
		const where = `rule ${JSON.stringify(rule.id ?? "?")}`;
		if (!rule.id || !/^[a-z0-9-]+$/.test(rule.id)) throw new ConfigError(`${where}: id must be kebab-case`);
		if (seen.has(rule.id)) throw new ConfigError(`${where}: duplicate id`);
		seen.add(rule.id);
		if (!RULE_TYPES.includes(rule.type)) throw new ConfigError(`${where}: type must be one of ${RULE_TYPES.join(", ")}`);
		if (!rule.message || !rule.fix) throw new ConfigError(`${where}: message and fix are required, the fix must name what to use instead`);
		requireStringArray(rule.exclude, `${where}: exclude`, { optional: true });
		if (rule.type !== "module-boundary") requireStringArray(rule.files, `${where}: files`);
		if (rule.type === "pattern") {
			if (!rule.pattern || typeof rule.pattern !== "string") throw new ConfigError(`${where}: pattern rules need a pattern string`);
			try {
				rule.regex = new RegExp(rule.pattern, "g" + (rule.flags ?? "").replace("g", ""));
			} catch (err) {
				throw new ConfigError(`${where}: bad pattern: ${err.message}`);
			}
		}
		if (rule.type === "forbidden-import") {
			if (!rule.to && !rule.toSpecifiers) throw new ConfigError(`${where}: forbidden-import rules need to[] or toSpecifiers[]`);
			requireStringArray(rule.to, `${where}: to`, { optional: true });
			requireStringArray(rule.toSpecifiers, `${where}: toSpecifiers`, { optional: true });
		}
		if (rule.type === "module-boundary") {
			if (!rule.modulesRoot || typeof rule.modulesRoot !== "string") throw new ConfigError(`${where}: module-boundary rules need modulesRoot`);
			requireStringArray(rule.publicEntry, `${where}: publicEntry`, { optional: true });
			rule.modulesRoot = rule.modulesRoot.replace(/\/+$/, "");
			rule.files = [`${rule.modulesRoot}/**`];
			rule.publicEntry = rule.publicEntry ?? ["index.js", "index.ts"];
		}
	}
	return config;
}

function lineOf(text, index) {
	let line = 1;
	for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
	return line;
}

export function blankComments(text) {
	const out = text.split("");
	let quote = null;
	for (let i = 0; i < out.length; i++) {
		const c = text[i];
		if (quote) {
			if (c === "\\") i++;
			else if (c === quote || (c === "\n" && quote !== "`")) quote = null;
		} else if (c === "'" || c === '"' || c === "`") quote = c;
		else if (c === "/" && text[i + 1] === "/") {
			while (i < out.length && text[i] !== "\n") out[i++] = " ";
		} else if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			const stop = end === -1 ? out.length : end + 2;
			for (; i < stop; i++) if (text[i] !== "\n") out[i] = " ";
			i--;
		}
	}
	return out.join("");
}

function extractImports(text) {
	const code = blankComments(text);
	const out = [];
	for (const re of IMPORT_RES) {
		re.lastIndex = 0;
		for (let m; (m = re.exec(code)); ) out.push({ spec: m[2], index: m.index + m[0].lastIndexOf(m[1] + m[2]) });
	}
	return out;
}

function resolveImport(root, fromRel, spec, aliases = {}) {
	const alias = Object.keys(aliases).find((a) => spec.startsWith(a));
	let base;
	if (alias) base = toPosix(path.normalize(aliases[alias] + spec.slice(alias.length)));
	else if (spec.startsWith(".")) base = toPosix(path.normalize(path.join(path.dirname(fromRel), spec.split("?")[0])));
	else return null;
	for (const ext of RESOLVE_EXT) {
		const candidate = base + ext;
		const abs = path.join(root, candidate);
		if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return candidate;
	}
	return base;
}

function findViolations(root, rule, rel, text, aliases) {
	const found = [];
	if (rule.type === "pattern") {
		rule.regex.lastIndex = 0;
		for (let m; (m = rule.regex.exec(text)); ) {
			found.push({ index: m.index, detail: m[0].trim().slice(0, 80) });
			if (m[0] === "") rule.regex.lastIndex++;
		}
	} else if (rule.type === "forbidden-import") {
		for (const imp of extractImports(text)) {
			const target = resolveImport(root, rel, imp.spec, aliases);
			const hit = (target !== null && matchesAny(target, rule.to)) || matchesAny(imp.spec, rule.toSpecifiers);
			if (hit) found.push({ index: imp.index, detail: `imports ${imp.spec}` });
		}
	} else if (rule.type === "module-boundary") {
		const prefix = rule.modulesRoot + "/";
		const own = rel.slice(prefix.length).split("/")[0];
		for (const imp of extractImports(text)) {
			const target = resolveImport(root, rel, imp.spec, aliases);
			if (target === null || !target.startsWith(prefix)) continue;
			const [mod, ...rest] = target.slice(prefix.length).split("/");
			if (mod === own) continue;
			if (rest.length === 1 && rule.publicEntry.includes(rest[0])) continue;
			found.push({ index: imp.index, detail: `imports ${imp.spec} (inside module ${mod})` });
		}
	}
	return found.map((f) => ({ line: lineOf(text, f.index), detail: f.detail }));
}

function isRealDate(s) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const d = new Date(s + "T00:00:00Z");
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(day, n) {
	const d = new Date(day + "T00:00:00Z");
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

function parseAllows(lines, { today, ruleIds, maxAllowDays }) {
	const allows = new Map();
	const problems = [];
	const latest = addDays(today, maxAllowDays);
	lines.forEach((text, i) => {
		const m = ALLOW_RE.exec(text);
		if (!m) return;
		const fields = Object.fromEntries([...m[2].matchAll(/(\w+)=(?:"([^"]*)"|(\S+))/g)].map((f) => [f[1], f[2] ?? f[3]]));
		const line = i + 1;
		const missing = ["reason", "until", "by"].filter((k) => !fields[k]);
		if (!ruleIds.has(m[1])) problems.push({ line, detail: `stack-agent-allow names unknown rule ${m[1]}` });
		else if (missing.length) problems.push({ line, detail: `stack-agent-allow for ${m[1]} is missing ${missing.join(", ")}` });
		else if (!isRealDate(fields.until)) problems.push({ line, detail: `stack-agent-allow until must be a real date YYYY-MM-DD, got ${fields.until}` });
		else if (fields.until < today) problems.push({ line, detail: `stack-agent-allow for ${m[1]} expired on ${fields.until}` });
		else if (fields.until > latest) problems.push({ line, detail: `stack-agent-allow for ${m[1]} runs to ${fields.until}, more than maxAllowDays (${maxAllowDays}) from today` });
		else {
			const ownLine = /^\s*(\/\/+|#+|--|\/\*+|\*|<!--)?\s*$/.test(text.slice(0, m.index));
			allows.set(`${m[1]}:${ownLine ? line + 1 : line}`, true);
		}
	});
	return { allows, problems };
}

export function runGuard({ root, config, files, today = new Date().toISOString().slice(0, 10), warnings }) {
	const all = files ?? walk(root, config.ignore);
	const violations = [];
	const ruleIds = new Set(config.rules.map((r) => r.id));
	if (!files && warnings) for (const r of config.rules) if (!all.some((f) => matchesAny(f, r.files) && !matchesAny(f, r.exclude))) warnings.push(`rule ${r.id} matches no files; check its files globs`);
	for (const rel of all) {
		const abs = path.join(root, rel);
		if (!fs.existsSync(abs) || fs.statSync(abs).size > 1_000_000) continue;
		const rules = config.rules.filter((r) => matchesAny(rel, r.files) && !matchesAny(rel, r.exclude));
		if (rules.length === 0) continue;
		const text = fs.readFileSync(abs, "utf8");
		if (text.includes("\0")) continue;
		const { allows, problems } = parseAllows(text.split("\n"), { today, ruleIds, maxAllowDays: config.maxAllowDays });
		for (const p of problems) {
			violations.push({ rule: "invalid-allow", file: rel, ...p, message: "exception comment is invalid or expired", fix: `write: stack-agent-allow <rule-id> reason="..." until=YYYY-MM-DD (at most ${config.maxAllowDays} days ahead) by=<approver>, or fix the code` });
		}
		for (const rule of rules) {
			for (const v of findViolations(root, rule, rel, text, config.aliases)) {
				if (allows.has(`${rule.id}:${v.line}`)) continue;
				violations.push({ rule: rule.id, file: rel, ...v, message: rule.message, fix: rule.fix });
			}
		}
	}
	return violations;
}

export function countViolations(violations) {
	const counts = {};
	for (const v of violations) {
		counts[v.rule] ??= {};
		counts[v.rule][v.file] = (counts[v.rule][v.file] ?? 0) + 1;
	}
	return counts;
}

export function compareToBaseline(violations, baselineCounts, scopeFiles) {
	const counts = countViolations(violations);
	const failing = [];
	const improvable = [];
	for (const [rule, byFile] of Object.entries(counts)) {
		for (const [file, n] of Object.entries(byFile)) {
			const allowed = baselineCounts[rule]?.[file] ?? 0;
			if (n > allowed) failing.push({ rule, file, count: n, allowed });
		}
	}
	for (const [rule, byFile] of Object.entries(baselineCounts)) {
		for (const [file, allowed] of Object.entries(byFile)) {
			if (scopeFiles && !scopeFiles.includes(file)) continue;
			const n = counts[rule]?.[file] ?? 0;
			if (n < allowed) improvable.push({ rule, file, count: n, allowed });
		}
	}
	return { failing, improvable };
}

function sortCounts(counts) {
	const out = {};
	for (const rule of Object.keys(counts).sort()) {
		const byFile = {};
		for (const file of Object.keys(counts[rule]).sort()) if (counts[rule][file] > 0) byFile[file] = counts[rule][file];
		if (Object.keys(byFile).length) out[rule] = byFile;
	}
	return out;
}

function gitShow(root, ref, rel) {
	const r = spawnSync("git", ["show", `${ref}:${rel}`], { cwd: root, encoding: "utf8" });
	return r.status === 0 ? r.stdout : null;
}

export function compareWithRef(root, ref, configRel, baselineRel, config, counts) {
	const problems = [];
	const notes = [];
	const verify = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: root, encoding: "utf8" });
	if (verify.status !== 0) throw new ConfigError(`--compare-ref: ${ref} is not a commit in this repo`);
	const oldBaseline = gitShow(root, ref, baselineRel);
	if (oldBaseline === null) notes.push(`${baselineRel} does not exist at ${ref}; nothing to compare (first adoption)`);
	else {
		let old;
		try {
			old = JSON.parse(oldBaseline).counts ?? {};
		} catch {
			old = {};
		}
		for (const [rule, byFile] of Object.entries(counts))
			for (const [file, n] of Object.entries(byFile)) if (n > (old[rule]?.[file] ?? 0)) problems.push(`baseline grew: ${rule} ${file} ${old[rule]?.[file] ?? 0} -> ${n}`);
	}
	const oldConfig = gitShow(root, ref, configRel);
	if (oldConfig !== null) {
		let oldRules = [];
		try {
			oldRules = JSON.parse(oldConfig).rules ?? [];
		} catch {}
		const now = new Map(config.rules.map((r) => [r.id, r]));
		for (const r of oldRules) {
			const cur = now.get(r.id);
			if (!cur) problems.push(`rule removed: ${r.id}`);
			else if (JSON.stringify(r.files ?? null) !== JSON.stringify(cur.type === "module-boundary" ? (r.files ?? null) : cur.files) || JSON.stringify(r.exclude ?? null) !== JSON.stringify(cur.exclude ?? null) || (r.pattern ?? null) !== (cur.pattern ?? null) || (r.modulesRoot ?? null) !== (cur.modulesRoot ?? null))
				problems.push(`rule changed scope: ${r.id} (files, exclude, pattern, or modulesRoot differ)`);
		}
	}
	return { problems, notes };
}

function main(argv) {
	const args = parseArgs(argv, { flags: ["json", "strict", "update-baseline", "allow-increase", "help"], options: ["root", "config", "compare-ref"], multi: ["files"] });
	if (args.help) return { code: 0, text: USAGE };
	const root = path.resolve(args.root ?? process.cwd());
	const configPath = path.resolve(root, args.config ?? ".stack-agent/guard.config.json");
	const config = loadConfig(configPath);
	const baselinePath = path.resolve(root, config.baseline ?? ".stack-agent/guard-baseline.json");
	const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath, "guard baseline") : { version: 1, counts: {} };
	const scopeFiles = args.files?.map((f) => toPosix(path.relative(root, path.resolve(root, f)))).filter((f) => !f.startsWith("../") && !path.isAbsolute(f));
	const warnings = [];
	const violations = runGuard({ root, config, files: scopeFiles, warnings });

	if (args["update-baseline"]) {
		if (scopeFiles) throw new ConfigError("--update-baseline scans the whole repo, do not combine it with --files");
		const firstBaseline = !fs.existsSync(baselinePath);
		const { failing } = compareToBaseline(violations, baseline.counts ?? {});
		if (failing.length && !firstBaseline && !args["allow-increase"]) {
			const lines = failing.map((f) => `  ${f.rule} ${f.file}: ${f.allowed} -> ${f.count}`);
			return { code: 1, text: `refusing to raise the baseline (needs a human-approved --allow-increase):\n${lines.join("\n")}` };
		}
		fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
		fs.writeFileSync(baselinePath, JSON.stringify({ version: 1, counts: sortCounts(countViolations(violations)) }, null, 2) + "\n");
		return { code: 0, text: `baseline written: ${toPosix(path.relative(root, baselinePath))} (${violations.length} known violations)` };
	}

	const { failing, improvable } = args.strict
		? compareToBaseline(violations, {}, scopeFiles)
		: compareToBaseline(violations, baseline.counts ?? {}, scopeFiles);
	const failingKeys = new Set(failing.map((f) => `${f.rule}|${f.file}`));
	const reported = violations.filter((v) => failingKeys.has(`${v.rule}|${v.file}`));
	const drift = args["compare-ref"] ? compareWithRef(root, args["compare-ref"], toPosix(path.relative(root, configPath)), toPosix(path.relative(root, baselinePath)), config, baseline.counts ?? {}) : { problems: [], notes: [] };
	const ok = failing.length === 0 && drift.problems.length === 0;
	if (args.json) return { code: ok ? 0 : 1, text: JSON.stringify({ ok, failing, violations: reported, improvable, refProblems: drift.problems, warnings }, null, 2) };

	const out = [];
	for (const v of reported) out.push(`${v.file}:${v.line}  [${v.rule}] ${v.message}\n    found: ${v.detail}\n    fix:   ${v.fix}`);
	for (const f of failing) if (f.allowed > 0) out.push(`  note: ${f.file} has ${f.count} ${f.rule} violations, baseline allows ${f.allowed}. Remove the new one(s).`);
	for (const i of improvable) out.push(`  improved: ${i.file} [${i.rule}] ${i.allowed} -> ${i.count}. Run --update-baseline to lock it in.`);
	for (const p of drift.problems) out.push(`compared with ${args["compare-ref"]}: ${p}`);
	for (const n of drift.notes) out.push(`  note: ${n}`);
	for (const w of warnings) out.push(`  warning: ${w}`);
	if (failing.length) out.push(`guard: FAIL (${failing.length} rule/file pair(s) over baseline)`);
	else if (drift.problems.length) out.push(`guard: FAIL (guard config or baseline loosened compared with ${args["compare-ref"]}; needs human review)`);
	else out.push(`guard: ok (${violations.length} known violation(s) within baseline)`);
	return { code: ok ? 0 : 1, text: out.join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		(code === 0 ? console.log : console.error)(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`guard: config error: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}

export { main };
