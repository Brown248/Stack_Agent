#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ConfigError, gitIgnored, matchesAny, parseArgs, projectFiles, readJson, requireStringArray, toPosix } from "./lib/files.mjs";

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
const PY_IMPORT_RE = /(?:^|[;:])[ \t]*(?:from[ \t]+(\.*[\w.]*)[ \t]+import\b|import\b)/gm;
const PY_NAME_RE = /([A-Za-z_][\w.]*)(?:\s+as\s+\w+)?|\*/g;
const ALLOW_RE = /stack-agent-allow\s+([\w-]+)((?:\s+\w+=(?:"[^"]*"|\S+))*)/;
const DEFAULT_MAX_ALLOW_DAYS = 90;

const MAX_EXTENDS_DEPTH = 5;

function gitTopOf(dir) {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8" });
	return r.status === 0 ? path.resolve(r.stdout.trim()) : null;
}

// Rules shared by several projects: "extends" lists JSON files, relative to the file that names them, each with
// its own "rules" (and optionally its own "extends"). Their rules come first; a project adds rules but cannot
// redefine or drop a shared one, so loosening a shared rule means changing the shared file, where review sees it.
// read(abs) returns the file's text or null; the boundary keeps every file inside the repository (or the project,
// outside git), so CI's checkout and --compare-ref can read it too. Returns { rules, files } with files absolute.
export function expandExtends(config, configAbs, { read, boundary, depth = 0, chain = [configAbs], strict = true }) {
	if (config.extends === undefined) return { rules: config.rules ?? [], files: [] };
	requireStringArray(config.extends, `extends in ${path.basename(configAbs)}`);
	if (depth >= MAX_EXTENDS_DEPTH) throw new ConfigError(`extends is nested more than ${MAX_EXTENDS_DEPTH} levels deep (${chain.map((c) => path.basename(c)).join(" -> ")})`);
	const rules = [];
	const files = [];
	for (const rel of config.extends) {
		const abs = path.resolve(path.dirname(configAbs), rel);
		const inside = path.relative(boundary, abs);
		if (inside.startsWith("..") || path.isAbsolute(inside)) throw new ConfigError(`extends ${rel}: the file must be inside the repository (${boundary}), so CI and --compare-ref can read it`);
		if (chain.includes(abs)) throw new ConfigError(`extends ${rel}: a file extends itself through ${chain.map((c) => path.basename(c)).join(" -> ")}`);
		const text = read(abs);
		if (text === null) {
			if (strict) throw new ConfigError(`extends ${rel}: file not found (${abs})`);
			continue;
		}
		let shared;
		try {
			shared = JSON.parse(text);
		} catch (err) {
			if (strict) throw new ConfigError(`extends ${rel} is not valid JSON: ${err.message}`);
			continue;
		}
		if (!Array.isArray(shared?.rules)) {
			if (strict) throw new ConfigError(`extends ${rel}: the file needs a rules array`);
			continue;
		}
		const nested = expandExtends(shared, abs, { read, boundary, depth: depth + 1, chain: [...chain, abs], strict });
		files.push(abs, ...nested.files);
		const from = toPosix(path.relative(path.dirname(chain[0]), abs));
		for (const rule of nested.rules) rules.push({ ...rule, sharedFrom: rule.sharedFrom ?? from });
	}
	return { rules: [...rules, ...(config.rules ?? [])], files };
}

const readOrNull = (abs) => {
	try {
		return fs.readFileSync(abs, "utf8");
	} catch {
		return null;
	}
};

export function loadConfig(configPath) {
	const config = readJson(configPath, "guard config");
	const configAbs = path.resolve(configPath);
	if (config.extends !== undefined) {
		const project = path.dirname(path.dirname(configAbs));
		const { rules, files } = expandExtends(config, configAbs, { read: readOrNull, boundary: gitTopOf(project) ?? project });
		config.rules = rules;
		config.extendedFiles = files;
	}
	if (!Array.isArray(config.rules) || config.rules.length === 0) throw new ConfigError("guard config needs a non-empty rules array");
	requireStringArray(config.ignore, "ignore", { optional: true });
	requireStringArray(config.pythonRoots, "pythonRoots", { optional: true });
	// rules init would suggest that this project leaves out on purpose; the guard itself ignores the list
	requireStringArray(config.declinedRules, "declinedRules", { optional: true });
	if (config.aliases !== undefined && (typeof config.aliases !== "object" || Array.isArray(config.aliases) || !Object.values(config.aliases).every((v) => typeof v === "string")))
		throw new ConfigError('aliases must map an import prefix to a repo path, e.g. {"@/": "src/"}');
	config.maxAllowDays ??= DEFAULT_MAX_ALLOW_DAYS;
	if (!Number.isInteger(config.maxAllowDays) || config.maxAllowDays < 1) throw new ConfigError("maxAllowDays must be a positive integer");
	const seen = new Set();
	for (const rule of config.rules) {
		const where = `rule ${JSON.stringify(rule.id ?? "?")}`;
		if (!rule.id || !/^[a-z0-9-]+$/.test(rule.id)) throw new ConfigError(`${where}: id must be kebab-case`);
		if (seen.has(rule.id)) throw new ConfigError(rule.sharedFrom || config.rules.some((r) => r.id === rule.id && r.sharedFrom) ? `${where}: already defined in a shared file (extends); a project cannot redefine a shared rule, change the shared file instead` : `${where}: duplicate id`);
		seen.add(rule.id);
		if (!RULE_TYPES.includes(rule.type)) throw new ConfigError(`${where}: type must be one of ${RULE_TYPES.join(", ")}`);
		if (!rule.message || !rule.fix) throw new ConfigError(`${where}: message and fix are required, the fix must name what to use instead`);
		requireStringArray(rule.exclude, `${where}: exclude`, { optional: true });
		// "skip": the after-edit hook leaves this rule out (for marks that are fine mid-task, like tagged debug lines); the guard and CI still enforce it
		if (rule.onEdit !== undefined && rule.onEdit !== "skip") throw new ConfigError(`${where}: onEdit can only be "skip"`);
		if (rule.type !== "module-boundary") requireStringArray(rule.files, `${where}: files`);
		if (rule.type === "pattern") {
			if (!rule.pattern || typeof rule.pattern !== "string") throw new ConfigError(`${where}: pattern rules need a pattern string`);
			try {
				if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(rule.pattern))
					throw new ConfigError(`${where}: pattern contains a control character; in JSON a regex \\b must be written "\\\\b"`);
				rule.regex = new RegExp(rule.pattern, "gm" + (rule.flags ?? "").replace(/[gm]/g, ""));
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

const countList = (list) => list.split(",").filter((s) => s.trim()).length;

// how many names an import statement binds, so adding a name to an existing forbidden import raises the count;
// a default, namespace, or side-effect import counts as one
function clauseWeight(clause) {
	const braces = /\{([^}]*)\}/.exec(clause);
	const rest = (braces ? clause.replace(braces[0], " ") : clause).replace(/\b(?:import|export|type|from)\b|,/g, " ").trim();
	return Math.max(1, (braces ? countList(braces[1]) : 0) + (rest ? 1 : 0));
}

function extractImports(text) {
	const code = blankComments(text);
	const out = [];
	IMPORT_RES.forEach((re, kind) => {
		re.lastIndex = 0;
		for (let m; (m = re.exec(code)); ) {
			const at = m[0].lastIndexOf(m[1] + m[2]);
			let weight;
			if (kind === 0) weight = clauseWeight(m[0].slice(0, at));
			else {
				// const { a, b } = require("x") binds two names
				const destructure = /\{([^{}]*)\}\s*=\s*(?:await\s+)?$/.exec(code.slice(Math.max(0, m.index - 400), m.index));
				weight = destructure ? Math.max(1, countList(destructure[1])) : 1;
			}
			out.push({ spec: m[2], index: m.index + at, weight });
		}
	});
	return out;
}

// strings are blanked too: a Python import never holds one, and docstrings often quote code
export function blankPython(text) {
	const out = text.split("");
	for (let i = 0; i < text.length; ) {
		const c = text[i];
		if (c === "#") {
			while (i < text.length && text[i] !== "\n") out[i++] = " ";
		} else if (c === "'" || c === '"') {
			const close = text.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
			let j = i + close.length;
			while (j < text.length && !text.startsWith(close, j) && (close.length === 3 || text[j] !== "\n")) j += text[j] === "\\" ? 2 : 1;
			const stop = Math.min(text.length, text.startsWith(close, j) ? j + close.length : j);
			for (; i < stop; i++) if (text[i] !== "\n") out[i] = " ";
		} else i++;
	}
	return out.join("");
}

function statementEnd(code, i) {
	let depth = 0;
	for (; i < code.length; i++) {
		const c = code[i];
		if (c === "(") depth++;
		else if (c === ")") depth--;
		else if (c === "\\") i++;
		else if ((c === "\n" || c === ";") && depth <= 0) break;
	}
	return i;
}

// a dotted name and the packages above it, so toSpecifiers "requests" also matches requests.adapters
function dottedPrefixes(name) {
	const parts = name.split(".");
	return parts.map((_, i) => parts.slice(0, i + 1).join(".")).filter((p) => !/^\.*$/.test(p) || p === name);
}

function isFile(root, rel, cache) {
	const key = "file:" + rel;
	let hit = cache.get(key);
	if (hit === undefined) {
		const abs = path.join(root, rel);
		cache.set(key, (hit = fs.existsSync(abs) && fs.statSync(abs).isFile()));
	}
	return hit;
}

// relative modules resolve against the importing file's package, absolute ones against pythonRoots;
// returns the repo path of the module file, the bare path for an unresolved relative import, or null (third-party)
function resolvePython(root, fromRel, mod, pythonRoots, cache) {
	const dots = /^\.*/.exec(mod)[0].length;
	const sub = mod.slice(dots).replaceAll(".", "/");
	let bases;
	if (dots) {
		let dir = path.posix.dirname(fromRel);
		for (let n = 1; n < dots; n++) dir = path.posix.dirname(dir);
		bases = [path.posix.join(dir, sub)];
	} else bases = pythonRoots.map((r) => path.posix.join(r, sub));
	for (const base of bases) {
		const candidates = sub ? [base + ".py", base + "/__init__.py"] : [base + "/__init__.py"];
		const hit = candidates.find((c) => isFile(root, c, cache));
		if (hit) return hit;
	}
	return dots ? bases[0] : null;
}

function extractPythonImports(text, rel, resolve) {
	const code = blankPython(text);
	const out = [];
	PY_IMPORT_RE.lastIndex = 0;
	for (let m; (m = PY_IMPORT_RE.exec(code)); ) {
		const end = statementEnd(code, PY_IMPORT_RE.lastIndex);
		const names = [...code.slice(PY_IMPORT_RE.lastIndex, end).matchAll(PY_NAME_RE)].map((n) => ({ name: n[1] ?? "*", index: PY_IMPORT_RE.lastIndex + n.index }));
		if (m[1] === undefined) {
			for (const n of names) if (n.name !== "*") out.push({ spec: n.name, specs: dottedPrefixes(n.name), target: resolve(n.name), index: n.index, weight: 1 });
		} else {
			const mod = m[1];
			const modIndex = m.index + m[0].lastIndexOf(mod, m[0].length - "import".length - 1);
			// `from pkg import name` imports pkg/name.py when that module exists, otherwise a name defined in pkg
			let plain = 0;
			for (const n of names) {
				const full = mod + (mod.endsWith(".") ? "" : ".") + n.name;
				const target = n.name === "*" ? null : resolve(full);
				if (target?.endsWith(".py")) out.push({ spec: full, specs: dottedPrefixes(full), target, index: n.index, weight: 1 });
				else plain++;
			}
			if (plain) out.push({ spec: mod, specs: [...dottedPrefixes(mod), ...names.map((n) => mod + (mod.endsWith(".") ? "" : ".") + n.name)], target: resolve(mod), index: modIndex, weight: plain });
		}
		PY_IMPORT_RE.lastIndex = Math.max(end, PY_IMPORT_RE.lastIndex);
	}
	return out;
}

function resolveImport(root, fromRel, spec, aliases = {}, cache = new Map()) {
	const alias = Object.keys(aliases).find((a) => spec.startsWith(a));
	let base;
	if (alias) base = toPosix(path.normalize(aliases[alias] + spec.slice(alias.length)));
	else if (spec.startsWith(".")) base = toPosix(path.normalize(path.join(path.dirname(fromRel), spec.split("?")[0])));
	else return null;
	// many files import the same targets, so each base is checked on disk once per run
	let resolved = cache.get(base);
	if (resolved === undefined) {
		resolved = base;
		for (const ext of RESOLVE_EXT) {
			const candidate = base + ext;
			const abs = path.join(root, candidate);
			if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
				resolved = candidate;
				break;
			}
		}
		cache.set(base, resolved);
	}
	return resolved;
}

function findViolations(root, rule, rel, text, aliases, imports, resolved) {
	const found = [];
	if (rule.type === "pattern") {
		rule.regex.lastIndex = 0;
		for (let m; (m = rule.regex.exec(text)); ) {
			found.push({ index: m.index, detail: m[0].trim().slice(0, 80) });
			if (m[0] === "") rule.regex.lastIndex++;
		}
	} else if (rule.type === "forbidden-import") {
		for (const imp of imports()) {
			const target = "target" in imp ? imp.target : resolveImport(root, rel, imp.spec, aliases, resolved);
			const hit = (target !== null && matchesAny(target, rule.to)) || (imp.specs ?? [imp.spec]).some((s) => matchesAny(s, rule.toSpecifiers));
			if (hit) found.push({ index: imp.index, weight: imp.weight, detail: `imports ${imp.spec}${imp.weight > 1 ? ` (${imp.weight} names)` : ""}` });
		}
	} else if (rule.type === "module-boundary") {
		const prefix = rule.modulesRoot + "/";
		const own = rel.slice(prefix.length).split("/")[0];
		const publicEntry = rule.publicEntry ?? (rel.endsWith(".py") ? ["__init__.py"] : ["index.js", "index.ts"]);
		for (const imp of imports()) {
			const target = "target" in imp ? imp.target : resolveImport(root, rel, imp.spec, aliases, resolved);
			if (target === null || !target.startsWith(prefix)) continue;
			const [mod, ...rest] = target.slice(prefix.length).split("/");
			if (mod === own) continue;
			if (rest.length === 1 && publicEntry.includes(rest[0])) continue;
			found.push({ index: imp.index, weight: imp.weight, detail: `imports ${imp.spec} (inside module ${mod}${imp.weight > 1 ? `, ${imp.weight} names` : ""})` });
		}
	}
	return found.map((f) => ({ line: lineOf(text, f.index), detail: f.detail, ...(f.weight > 1 && { weight: f.weight }) }));
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

function parseAllows(lines, { today, latest, ruleIds, maxAllowDays }) {
	const allows = new Map();
	const problems = [];
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

export const MAX_FILE_BYTES = 1_000_000;

export function runGuard({ root, config, files, today = new Date().toISOString().slice(0, 10), warnings }) {
	// gitignored files never reach CI, so they are not scanned here either, also when named one by one
	const ignored = files ? gitIgnored(root, files) : new Set();
	const all = files ? files.filter((f) => !ignored.has(f)) : projectFiles(root, config.ignore);
	const violations = [];
	const ruleIds = new Set(config.rules.map((r) => r.id));
	const latest = addDays(today, config.maxAllowDays);
	const resolved = new Map();
	const pythonRoots = config.pythonRoots ?? [".", ...(fs.existsSync(path.join(root, "src")) && fs.statSync(path.join(root, "src")).isDirectory() ? ["src"] : [])];
	if (!files && warnings) for (const r of config.rules) if (!all.some((f) => matchesAny(f, r.files) && !matchesAny(f, r.exclude))) warnings.push(`rule ${r.id} matches no files; check its files globs`);
	for (const rel of all) {
		const abs = path.join(root, rel);
		let size;
		try {
			size = fs.statSync(abs).size;
		} catch {
			continue;
		}
		const rules = config.rules.filter((r) => matchesAny(rel, r.files) && !matchesAny(rel, r.exclude));
		if (rules.length === 0) continue;
		if (size > MAX_FILE_BYTES) {
			warnings?.push(`${rel} is over 1 MB, so no rule checked it; add it to "ignore" if that is intended`);
			continue;
		}
		const text = fs.readFileSync(abs, "utf8");
		if (text.includes("\0")) continue;
		const { allows, problems } = parseAllows(text.split("\n"), { today, latest, ruleIds, maxAllowDays: config.maxAllowDays });
		for (const p of problems) {
			violations.push({ rule: "invalid-allow", file: rel, ...p, message: "exception comment is invalid or expired", fix: `write: stack-agent-allow <rule-id> reason="..." until=YYYY-MM-DD (at most ${config.maxAllowDays} days ahead) by=<approver>, or fix the code` });
		}
		// parsed at most once per file, and only if an import rule asks and the text could hold an import or re-export
		let imports;
		const importsOf = () => (imports ??= !/import|export|require/.test(text) ? [] : rel.endsWith(".py") ? extractPythonImports(text, rel, (mod) => resolvePython(root, rel, mod, pythonRoots, resolved)) : extractImports(text));
		for (const rule of rules) {
			for (const v of findViolations(root, rule, rel, text, config.aliases, importsOf, resolved)) {
				if (allows.has(`${rule.id}:${v.line}`)) continue;
				violations.push({ rule: rule.id, file: rel, ...v, message: rule.message, fix: rule.fix });
			}
		}
	}
	return violations;
}

// version 1 counted import statements, so adding a name to an existing forbidden import went unnoticed;
// version 2 counts each imported name. A version 1 baseline is still read with statement counting.
export const BASELINE_VERSION = 2;

export function baselineVersion(baseline) {
	const version = baseline?.version ?? 1;
	if (version !== 1 && version !== BASELINE_VERSION) throw new ConfigError(`guard baseline version ${JSON.stringify(version)} is not supported (this guard reads 1 and ${BASELINE_VERSION}); update the vendored tools`);
	return version;
}

export function countViolations(violations, version = BASELINE_VERSION) {
	const counts = {};
	for (const v of violations) {
		counts[v.rule] ??= {};
		counts[v.rule][v.file] = (counts[v.rule][v.file] ?? 0) + (version >= 2 ? (v.weight ?? 1) : 1);
	}
	return counts;
}

export function compareToBaseline(violations, baselineCounts, scopeFiles, version = BASELINE_VERSION) {
	const counts = countViolations(violations, version);
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

// "./" makes git read rel from root, not from the top of the repository, so a project in a subfolder compares its own files
function gitShow(root, ref, rel) {
	const r = spawnSync("git", ["show", `${ref}:./${rel}`, "--"], { cwd: root, encoding: "utf8" });
	return r.status === 0 ? r.stdout : null;
}

// counts is the current baseline; liveV1 is the current code counted per statement, used when the ref still has a version 1 baseline
export function compareWithRef(root, ref, configRel, baselineRel, config, counts, { version = BASELINE_VERSION, liveV1 = {} } = {}) {
	const problems = [];
	const notes = [];
	const verify = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: root, encoding: "utf8" });
	if (verify.status !== 0) throw new ConfigError(`--compare-ref: ${ref} is not a commit in this repo`);
	const oldBaseline = gitShow(root, ref, baselineRel);
	if (oldBaseline === null) notes.push(`${baselineRel} does not exist at ${ref}; nothing to compare (first adoption)`);
	else {
		let old;
		let oldVersion = 1;
		try {
			const parsed = JSON.parse(oldBaseline);
			old = parsed.counts ?? {};
			oldVersion = parsed.version ?? 1;
		} catch {
			old = {};
		}
		if (oldVersion > version) problems.push(`baseline version went down: ${oldVersion} -> ${version}`);
		else if (oldVersion < version) {
			// the two files count in different units, so compare the old statement counts with the current code counted the same way
			notes.push(`${baselineRel} is version ${oldVersion} at ${ref} and version ${version} now; compared the current code's statement counts with it`);
			for (const [rule, byFile] of Object.entries(counts))
				for (const [file, n] of Object.entries(byFile)) if (n > (old[rule]?.[file] ?? 0)) notes.push(`review: ${rule} ${file} was ${old[rule]?.[file] ?? 0} statement(s) and is now ${n} imported name(s)`);
			counts = liveV1;
		}
		for (const [rule, byFile] of Object.entries(counts))
			for (const [file, n] of Object.entries(byFile)) if (n > (old[rule]?.[file] ?? 0)) problems.push(`baseline grew: ${rule} ${file} ${old[rule]?.[file] ?? 0} -> ${n}`);
	}
	const oldConfig = gitShow(root, ref, configRel);
	if (oldConfig !== null) {
		let oldRules = [];
		try {
			// the rules the config had at ref, shared files included as they were at ref, so loosening a shared file fails too
			const show = (abs) => gitShow(root, ref, toPosix(path.relative(root, abs)));
			oldRules = expandExtends(JSON.parse(oldConfig), path.resolve(root, configRel), { read: show, boundary: gitTopOf(root) ?? root, strict: false }).rules;
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
	const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath, "guard baseline") : { version: BASELINE_VERSION, counts: {} };
	const version = baselineVersion(baseline);
	const scopeFiles = args.files?.map((f) => toPosix(path.relative(root, path.resolve(root, f)))).filter((f) => !f.startsWith("../") && !path.isAbsolute(f));
	const warnings = [];
	const violations = runGuard({ root, config, files: scopeFiles, warnings });

	if (args["update-baseline"]) {
		if (scopeFiles) throw new ConfigError("--update-baseline scans the whole repo, do not combine it with --files");
		const firstBaseline = !fs.existsSync(baselinePath);
		// an old baseline is checked in its own units, so upgrading it needs no --allow-increase unless the code got worse
		const { failing } = compareToBaseline(violations, baseline.counts ?? {}, undefined, version);
		if (failing.length && !firstBaseline && !args["allow-increase"]) {
			const lines = failing.map((f) => `  ${f.rule} ${f.file}: ${f.allowed} -> ${f.count}`);
			return { code: 1, text: `refusing to raise the baseline (needs a human-approved --allow-increase):\n${lines.join("\n")}` };
		}
		fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
		fs.writeFileSync(baselinePath, JSON.stringify({ version: BASELINE_VERSION, counts: sortCounts(countViolations(violations)) }, null, 2) + "\n");
		const upgraded = !firstBaseline && version < BASELINE_VERSION ? `; upgraded from version ${version}, import rules now count each imported name` : "";
		return { code: 0, text: `baseline written: ${toPosix(path.relative(root, baselinePath))} (${violations.length} known violations${upgraded})` };
	}

	const { failing, improvable } = args.strict
		? compareToBaseline(violations, {}, scopeFiles)
		: compareToBaseline(violations, baseline.counts ?? {}, scopeFiles, version);
	const failingKeys = new Set(failing.map((f) => `${f.rule}|${f.file}`));
	const reported = violations.filter((v) => failingKeys.has(`${v.rule}|${v.file}`));
	const drift = args["compare-ref"] ? compareWithRef(root, args["compare-ref"], toPosix(path.relative(root, configPath)), toPosix(path.relative(root, baselinePath)), config, baseline.counts ?? {}, { version, liveV1: countViolations(violations, 1) }) : { problems: [], notes: [] };
	if (version < BASELINE_VERSION) drift.notes.push(`the baseline is version ${version}, which counts import statements, so adding a name to an existing forbidden import is not caught. Run --update-baseline to switch to version ${BASELINE_VERSION}.`);
	const ok = failing.length === 0 && drift.problems.length === 0;
	if (args.json) return { code: ok ? 0 : 1, text: JSON.stringify({ ok, failing, violations: reported, improvable, refProblems: drift.problems, notes: drift.notes, warnings }, null, 2) };

	const out = [];
	for (const v of reported) out.push(`${v.file}:${v.line}  [${v.rule}] ${v.message}\n    found: ${v.detail}\n    fix:   ${v.fix}`);
	const perName = new Set(version >= 2 ? config.rules.filter((r) => r.type !== "pattern").map((r) => r.id) : []);
	for (const f of failing) if (f.allowed > 0) out.push(`  note: ${f.file} has ${f.count} ${f.rule} violations${perName.has(f.rule) ? " (each imported name counts)" : ""}, baseline allows ${f.allowed}. Remove the new one(s).`);
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
