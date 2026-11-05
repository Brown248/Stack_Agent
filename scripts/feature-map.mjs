#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs, readJson } from "./lib/files.mjs";

const USAGE = `usage: node feature-map.mjs [--root DIR] [--map FILE] [--draft] [--suggest] [--json]
  default    check the feature map against the code and the verify checks (drift check)
  --draft    print a map table with one row per verify check, for an agent to fill in and a human to review
  --suggest  with the drift check: for each problem, say where a moved file or anchor went and which check is
             the closest name. Reads only; it never edits the map
  --map      the map file, relative to --root (default .stack-agent/feature-map.md)
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

// Backticks around a whole cell are formatting; a backtick that opens or closes only part of the text is content.
const unquote = (s) => s.trim().replace(/^`([^`]*)`$/, "$1");

// One table row to cells. A pipe written \| stays in the text; the leading and trailing pipes are not cells.
function cells(line) {
	const t = line.trim();
	const out = [];
	let cur = "";
	for (let i = 0; i < t.length; i++) {
		if (t[i] === "\\" && t[i + 1] === "|") {
			cur += "|";
			i++;
		} else if (t[i] === "|") {
			out.push(cur);
			cur = "";
		} else cur += t[i];
	}
	out.push(cur);
	if (t.startsWith("|")) out.shift();
	if (t.endsWith("|") && !t.endsWith("\\|")) out.pop();
	return out.map(unquote);
}
const list = (cell) => cell.split(",").map(unquote).filter((s) => s && s !== "-");
const norm = (s) => s.normalize("NFC").replace(/\s+/g, " ").trim();
const key = (s) => norm(s).toLowerCase();

// The tables of a map text, each with the heading above it. Lines inside a code fence are skipped, so an example
// table in a template or a doc is never read as the real map.
function tables(text) {
	const out = [];
	let fence = null;
	let heading = null;
	let current = null;
	for (const line of text.split(/\r?\n/)) {
		const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
		if (f) {
			if (!fence) fence = f[1][0];
			else if (f[1][0] === fence) fence = null;
			current = null;
			continue;
		}
		if (fence) continue;
		if (!line.trim().startsWith("|")) {
			current = null;
			const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
			if (h) heading = h[1].replace(/`/g, "").trim();
			continue;
		}
		const c = cells(line);
		if (!current) {
			current = { kind: /^feature$/i.test(c[0]) ? "feature" : /^case$/i.test(c[0]) ? "case" : "other", heading, rows: [] };
			out.push(current);
			continue;
		}
		if (/^:?-+:?$/.test(c[0])) continue;
		current.rows.push(c);
	}
	return out;
}

export function parseFeatureMap(text) {
	const rows = [];
	for (const t of tables(text)) {
		if (t.kind !== "feature") continue;
		for (const c of t.rows) rows.push({ feature: c[0], where: list(c[1] ?? "").filter((p) => p !== "TODO"), reach: c[2] ?? "", checks: list(c[3] ?? "").filter((p) => p !== "TODO"), raw: c });
	}
	return rows;
}

// Optional "### Cases: <feature>" sections: what is checked for that feature besides the normal path. A Case table with
// no such heading above it has feature null, which the diff reports.
export function parseCases(text) {
	const sections = [];
	for (const t of tables(text)) {
		if (t.kind !== "case") continue;
		const m = t.heading ? /^cases:\s*(.+)$/i.exec(t.heading) : null;
		const cases = t.rows.map((c) => ({ name: c[0], expected: c[1] ?? "", checks: list(c[2] ?? "").filter((p) => p !== "TODO"), raw: c }));
		sections.push({ feature: m ? m[1].trim() : null, cases });
	}
	return sections;
}

// the first segment of file whose letter case differs from the real directory listing, or null
function caseMismatch(root, file) {
	let dir = root;
	for (const seg of file.split(/[\\/]/).filter((s) => s && s !== ".")) {
		let names;
		try {
			names = fs.readdirSync(dir);
		} catch {
			return null;
		}
		if (names.some((n) => n.normalize("NFC") === seg.normalize("NFC"))) {
			dir = path.join(dir, seg);
			continue;
		}
		return names.some((n) => n.normalize("NFC").toLowerCase() === seg.normalize("NFC").toLowerCase()) ? seg : null;
	}
	return null;
}

export function diffFeatureMap({ root, rows, checkNames, sections = [] }) {
	const problems = [];
	const warnings = [];
	const details = [];
	const add = (text, extra = {}) => {
		problems.push(text);
		details.push({ text, ...extra });
	};
	const named = new Set();
	const seen = new Set();
	const seenKeys = new Map();
	for (const row of rows) {
		const name = row.feature || "(no name)";
		if (seen.has(name)) add(`${name}: listed twice`);
		else if (seenKeys.has(key(name))) warnings.push(`${name}: may be the same feature as ${seenKeys.get(key(name))}`);
		seen.add(name);
		if (!seenKeys.has(key(name))) seenKeys.set(key(name), name);
		if (!row.where.length) add(`${name}: no place in the Where column`);
		for (const place of row.where) {
			const { file, line, anchor } = parsePlace(place);
			const abs = path.resolve(root, file);
			const rel = path.relative(root, abs);
			if (rel.startsWith("..") || path.isAbsolute(rel)) {
				add(`${name}: ${file} is outside the repository`);
				continue;
			}
			if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
				add(`${name}: ${file} does not exist`, { feature: name, kind: "file", file });
				continue;
			}
			const wrong = caseMismatch(root, file);
			if (wrong) {
				add(`${name}: ${file} differs from the real file name in letter case (at ${wrong}); Linux CI would not find it`, { feature: name, kind: "file", file });
				continue;
			}
			const text = line !== undefined || anchor !== undefined ? fs.readFileSync(abs, "utf8") : "";
			if (line !== undefined && line > text.split("\n").length) add(`${name}: ${file} has no line ${line}`, { feature: name, kind: "line", file });
			if (anchor !== undefined && !text.includes(anchor)) add(`${name}: ${file} no longer contains ${JSON.stringify(anchor)}`, { feature: name, kind: "anchor", file, anchor });
		}
		for (const check of row.checks) {
			named.add(check);
			if (!checkNames.includes(check)) add(`${name}: no verify check named ${check}`, { feature: name, kind: "check", check });
		}
		if (row.raw.some((c) => /\bTODO\b/.test(c))) warnings.push(`${name}: still has TODO cells, a human has not reviewed it`);
	}

	const sectionsOf = new Map();
	let caseCount = 0;
	let casesCovered = 0;
	for (const s of sections) {
		if (s.feature === null) {
			add('a Case table with no "Cases: <feature>" heading above it');
			continue;
		}
		const row = rows.find((r) => r.feature === s.feature) ?? rows.find((r) => key(r.feature) === key(s.feature));
		if (!row) {
			add(`Cases: ${s.feature}: no feature of that name in the table`);
			continue;
		}
		if (sectionsOf.has(row.feature)) {
			add(`${row.feature}: more than one Cases section`);
			continue;
		}
		sectionsOf.set(row.feature, s);
		const names = new Set();
		for (const c of s.cases) {
			caseCount++;
			const label = `${row.feature} / ${c.name || "(no name)"}`;
			if (names.has(c.name)) add(`${label}: listed twice`);
			names.add(c.name);
			for (const check of c.checks) {
				named.add(check);
				if (!checkNames.includes(check)) add(`${label}: no verify check named ${check}`, { feature: row.feature, kind: "check", check });
			}
			if (c.checks.length) casesCovered++;
			else warnings.push(`${label}: no verify check covers this case`);
			if (c.raw.some((x) => /\bTODO\b/.test(x))) warnings.push(`${label}: still has TODO cells, a human has not reviewed it`);
		}
	}

	let covered = 0;
	for (const row of rows) {
		const viaCases = sectionsOf.get(row.feature)?.cases.some((c) => c.checks.length) ?? false;
		if (row.checks.length || viaCases) covered++;
		else warnings.push(`${row.feature || "(no name)"}: no verify check covers it`);
	}
	for (const check of checkNames) if (!named.has(check)) warnings.push(`verify check ${check} is in no row or case`);
	return { problems, warnings, details, covered, cases: caseCount, casesCovered, named };
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

// ---- --suggest: where a moved file or anchor went, deterministic and read-only ----

const MAX_FILES = 5000;
const MAX_BYTES = 1024 * 1024;
const SKIP_DIR = /(^|\/)(node_modules|\.git)\//;

function repoFiles(root) {
	const git = spawnSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
	let files;
	if (git.status === 0 && git.stdout) files = git.stdout.split("\0").filter(Boolean);
	else {
		files = [];
		const walk = (dir) => {
			for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
				if (files.length > MAX_FILES) return;
				const rel = path.relative(root, path.join(dir, e.name)).split(path.sep).join("/");
				if (SKIP_DIR.test(`${rel}/`)) continue;
				if (e.isDirectory()) walk(path.join(dir, e.name));
				else if (e.isFile()) files.push(rel);
			}
		};
		walk(root);
	}
	return files.map((f) => f.split(path.sep).join("/")).filter((f) => !SKIP_DIR.test(f)).sort().slice(0, MAX_FILES);
}

// old path -> new path for renames git knows about (committed, or staged in the working tree)
function gitRenames(root) {
	const map = new Map();
	for (const args of [["diff", "--name-status", "-M", "HEAD"], ["log", "-M", "--name-status", "--diff-filter=R", "--format=", "-n", "300"]]) {
		const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
		if (r.status !== 0) continue;
		for (const line of r.stdout.split(/\r?\n/)) {
			const m = /^R\d*\t(.+)\t(.+)$/.exec(line);
			if (m && !map.has(m[1])) map.set(m[1], m[2]);
		}
	}
	return map;
}

function distance(a, b) {
	const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let diag = prev[0];
		prev[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const tmp = prev[j];
			prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
			diag = tmp;
		}
	}
	return prev[b.length];
}

export function suggest({ root, details, checkNames, used = new Set() }) {
	if (!details.length) return [];
	const out = [];
	const files = repoFiles(root);
	const renames = details.some((d) => d.kind === "file") ? gitRenames(root) : new Map();
	const readable = (f) => {
		try {
			const abs = path.join(root, f);
			if (fs.statSync(abs).size > MAX_BYTES) return null;
			const buf = fs.readFileSync(abs);
			return buf.subarray(0, 8000).includes(0) ? null : buf.toString("utf8");
		} catch {
			return null;
		}
	};
	const cache = new Map();
	const textOf = (f) => (cache.has(f) ? cache.get(f) : cache.set(f, readable(f)).get(f));
	for (const d of details) {
		if (d.kind === "file") {
			let moved = renames.get(d.file);
			for (let hops = 0; moved && renames.has(moved) && hops < 5; hops++) moved = renames.get(moved);
			const base = path.posix.basename(d.file.split("\\").join("/")).toLowerCase();
			const same = files.filter((f) => path.posix.basename(f).toLowerCase() === base && f !== d.file);
			const found = [...new Set([...(moved && files.includes(moved) ? [moved] : []), ...same])];
			if (found.length === 1) out.push(`${d.feature}: ${d.file} may now be ${found[0]}`);
			else if (found.length > 1) out.push(`${d.feature}: ${d.file} may now be one of ${found.slice(0, 5).join(", ")}`);
		} else if (d.kind === "anchor") {
			const hits = files.filter((f) => f !== d.file && !f.startsWith(".stack-agent/") && (textOf(f) ?? "").includes(d.anchor));
			if (hits.length) out.push(`${d.feature}: ${JSON.stringify(d.anchor)} is now in ${hits.slice(0, 5).join(", ")}`);
		} else if (d.kind === "check") {
			const limit = Math.max(3, Math.floor(d.check.length / 2));
			const near = checkNames
				.filter((n) => !used.has(n))
				.map((n) => ({ n, dist: n.startsWith(d.check) || d.check.startsWith(n) ? 0 : distance(n, d.check) }))
				.filter((x) => x.dist <= limit)
				.sort((a, b) => a.dist - b.dist || a.n.localeCompare(b.n))
				.slice(0, 3)
				.map((x) => x.n);
			if (near.length) out.push(`${d.feature}: ${d.check}, did you mean ${near.join(" or ")}`);
		}
	}
	return out;
}

export function main(argv) {
	const args = parseArgs(argv, { flags: ["draft", "json", "help", "suggest"], options: ["root", "map"] });
	if (args.help) return { code: 0, text: USAGE };
	const root = path.resolve(args.root ?? process.cwd());
	const checks = checksOf(root);
	if (args.draft) return { code: 0, text: draftFeatureMap(checks) };
	const mapRel = args.map ?? DEFAULT_MAP;
	const mapFile = path.resolve(root, mapRel);
	if (!fs.existsSync(mapFile)) throw new ConfigError(`feature map not found: ${mapRel}. Create it from --draft first.`);
	const mapText = fs.readFileSync(mapFile, "utf8");
	const rows = parseFeatureMap(mapText);
	if (!rows.length) throw new ConfigError(`${mapRel} has no table with a "Feature" header row`);
	const checkNames = checks.map((c) => c.name);
	const { problems, warnings, details, covered, cases, casesCovered, named } = diffFeatureMap({ root, rows, checkNames, sections: parseCases(mapText) });
	const suggestions = args.suggest && problems.length ? suggest({ root, details, checkNames, used: named }) : [];
	if (args.json) return { code: problems.length ? 1 : 0, text: JSON.stringify({ ok: problems.length === 0, features: rows.length, cases, problems, warnings, ...(args.suggest ? { suggestions } : {}) }, null, 2) };
	const out = [...problems, ...suggestions.map((s) => `  suggestion: ${s}`), ...warnings.map((w) => `  warning: ${w}`)];
	const tail = cases ? `, ${cases} case(s), ${casesCovered} covered by checks` : "";
	out.push(problems.length ? `feature-map: DRIFT (${problems.length} problem(s))` : `feature-map: ok (${rows.length} feature(s), ${covered} covered by verify checks${tail})`);
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
