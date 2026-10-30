#!/usr/bin/env node
// Review findings as data: a reviewer (the finder) proposes candidates, a different agent (the verifier) decides
// each one, and this script checks the result. Every location and evidence entry quotes the code it points at,
// and the quote must appear within a few lines of the cited line, so a finding is tied to real code.
// The verdicts and their required/forbidden fields follow cloudflare/security-audit-skill (MIT), cut down for
// code review. Validation proves format and source grounding only, not that a finding is right.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs, toPosix } from "./lib/files.mjs";

const USAGE = `usage: node review-findings.mjs validate FILE [--stage candidates|final] [--root DIR] [--ref REV] [--candidates FILE] [--json]
       node review-findings.mjs rows FILE --date YYYY-MM-DD
  validate  checks shape, the fields each verdict requires or forbids, unique ids, who found vs who verified,
            that a finding about a commit cites at least one file that commit changed (not for commit "worktree"),
            and that every quoted excerpt appears within ${3} lines of its cited line, read from --root (default the
            current folder; pass a review worktree for a past commit) or from git revision --ref; with --candidates,
            also that every candidate in that file has exactly one final record and there are no others
  rows      prints review-log rows for a final findings file
exit codes: 0 valid, 1 invalid, 2 usage or unreadable input`;

export const VERDICTS = ["candidate", "confirmed", "hardening", "needs_validation", "rejected"];
// verdicts a verifier can give; hardening = the problem would be real, but another layer in this code already stops it
export const FINAL_VERDICTS = VERDICTS.filter((v) => v !== "candidate");
export const SEVERITIES = ["blocking", "non-blocking"];
export const KINDS = ["repeatable", "one-off"];
// where a finding comes from; script-verifiable sources may be confirmed by re-running the script
export const SOURCE_RE = /^(guard:[\w-]+|api-map|verify-evidence|rules\.md:\d+|standards:[^\s:]+:\d+|correctness|spec)$/;
// files a repo writes its own standards in; a `standards:<file>:<line>` finding cites one of them, in any folder
export const STANDARDS_FILES = ["CONTRIBUTING.md", "CODING_STANDARDS.md", "STYLEGUIDE.md", "STYLE.md", "AGENTS.md", "CLAUDE.md"];
const STANDARDS_RE = /^standards:([^\s:]+):(\d+)$/;
const SOURCE_LIST = "guard:<rule-id>, api-map, verify-evidence, rules.md:<line>, standards:<file>:<line>, correctness, or spec";
// a `spec` finding quotes what was asked: { from: "commit-message" | <file relative to the root>, quote }
export const SPEC_FROM_COMMIT = "commit-message";
// rule ids the guard reports on its own, not from guard.config.json
const GUARD_BUILTIN_RULES = ["invalid-allow"];
const SCRIPT_SOURCES = /^(guard:[\w-]+|api-map|verify-evidence)$/;
const EXCERPT_WINDOW = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_RECORDS = 1000;
const MAX_ERRORS = 100;

export const COMMON = ["id", "commit", "title", "claim", "location", "source", "evidence", "verdict"];
// fields each verdict requires beyond COMMON, and every other optional field is forbidden
export const FIELDS = {
	candidate: [],
	confirmed: ["severity", "kind", "observed", "fix", "found_by", "verified_by"],
	hardening: ["control", "suggestion", "found_by", "verified_by"],
	needs_validation: ["blockers", "how_to_check", "found_by", "verified_by"],
	rejected: ["reason", "found_by", "verified_by"],
};
const ALL_OPTIONAL = [...new Set(Object.values(FIELDS).flat())];

// What shows nothing: white space, control characters, format characters (the zero-width space, the byte order mark, the
// bidirectional controls, tag characters, variation selectors, and the code points reserved to be invisible), lone surrogates, and the blank fillers (Hangul, Braille). A field made only of
// these is not text: it would pass as "non-empty" and say nothing. Combining marks count as nothing when no base
// character carries them. Idea from cloudflare/security-audit-skill (MIT), whose validator requires a visible character.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Cs}\p{Default_Ignorable_Code_Point}\sㅤ⠀ᅟᅠﾠ]/gu;
const isText = (v) => typeof v === "string" && v.replace(INVISIBLE, "").replace(/\p{M}/gu, "").length > 0;
const norm = (s) => String(s).replace(/\s+/g, " ").trim();
// how much of a quote shows: its characters without the invisible ones and the spaces
const seen = (s) => String(s).replace(INVISIBLE, "");
// Text for a terminal or a log: a control character, a line or paragraph separator, a bidirectional control, or a tag
// character is written as \u{..}. A finding is data from a model and quotes code, and without this its id, a field
// name, or a quote could move the cursor, clear the screen, reorder what is shown (the bidirectional "Trojan Source"
// trick), or carry text no one can see (tag characters). The zero-width joiner and non-joiner stay: Thai, Persian, and
// emoji sequences need them.
export const printable = (s) => String(s).replace(/[\p{Cc}\p{Zl}\p{Zp}؜‎‏‪-‮⁦-⁩\u{e0000}-\u{e007f}\u2065\ufff0-\ufff8\u{e0080}-\u{e0fff}]/gu, (ch) => `\\u{${ch.codePointAt(0).toString(16)}}`);

function checkPlace(place, where, errors, { needDescription }) {
	if (!place || typeof place !== "object" || Array.isArray(place)) return errors.push(`${where} must be an object with file, line, excerpt`);
	if (!isText(place.file) || path.isAbsolute(place.file) || place.file.split(/[\\/]/).includes("..")) errors.push(`${where}.file must be a path relative to the project root`);
	if (!Number.isInteger(place.line) || place.line < 1) errors.push(`${where}.line must be an integer of at least 1`);
	if (!isText(place.excerpt) || seen(place.excerpt).length < 3) errors.push(`${where}.excerpt must quote at least 3 characters of the code at that line`);
	if (needDescription && !isText(place.description)) errors.push(`${where}.description is required`);
	const extra = Object.keys(place).filter((k) => !["file", "line", "excerpt", "description"].includes(k));
	if (extra.length) errors.push(`${where} has unknown field(s): ${extra.join(", ")}`);
}

// shape and per-verdict rules; no file access
export function checkRecords(records, { stage = "final" } = {}) {
	const errors = [];
	if (!Array.isArray(records)) return ["findings must be a JSON array"];
	if (records.length > MAX_RECORDS) return [`too many findings (${records.length} > ${MAX_RECORDS})`];
	const ids = new Set();
	records.forEach((r, i) => {
		const at = `finding ${i + 1}${isText(r?.id) ? ` (${r.id})` : ""}`;
		if (!r || typeof r !== "object" || Array.isArray(r)) return errors.push(`${at} must be an object`);
		for (const k of COMMON) if (r[k] === undefined) errors.push(`${at}: missing ${k}`);
		const allowedVerdicts = stage === "candidates" ? ["candidate"] : FINAL_VERDICTS;
		if (!allowedVerdicts.includes(r.verdict)) errors.push(`${at}: verdict must be ${allowedVerdicts.join(" | ")} at the ${stage} stage`);
		for (const k of ["id", "commit", "title", "claim"]) if (r[k] !== undefined && !isText(r[k])) errors.push(`${at}: ${k} must be non-empty text`);
		if (isText(r.id)) {
			if (ids.has(r.id)) errors.push(`${at}: duplicate id`);
			ids.add(r.id);
		}
		if (r.source !== undefined && !(typeof r.source === "string" && SOURCE_RE.test(r.source))) errors.push(`${at}: source must be ${SOURCE_LIST}`);
		const std = typeof r.source === "string" ? STANDARDS_RE.exec(r.source) : null;
		if (std) {
			if (path.isAbsolute(std[1]) || std[1].split(/[\\/]/).includes("..")) errors.push(`${at}: ${r.source} must cite a file relative to the project root`);
			else if (!STANDARDS_FILES.some((n) => n.toLowerCase() === path.posix.basename(toPosix(std[1])).toLowerCase())) errors.push(`${at}: ${r.source} must cite one of ${STANDARDS_FILES.join(", ")}`);
		}
		if (r.source === "spec") {
			const s = r.spec;
			if (!s || typeof s !== "object" || Array.isArray(s)) errors.push(`${at}: a spec finding needs spec: { from, quote }`);
			else {
				if (!isText(s.from) || (s.from !== SPEC_FROM_COMMIT && (path.isAbsolute(s.from) || s.from.split(/[\\/]/).includes("..")))) errors.push(`${at}: spec.from must be ${SPEC_FROM_COMMIT} or a file relative to the project root`);
				if (!isText(s.quote) || seen(s.quote).length < 3) errors.push(`${at}: spec.quote must quote at least 3 characters of what was asked`);
				const extraSpec = Object.keys(s).filter((k) => !["from", "quote"].includes(k));
				if (extraSpec.length) errors.push(`${at}: spec has unknown field(s): ${extraSpec.join(", ")}`);
				if (s.from === SPEC_FROM_COMMIT && r.commit === "worktree") errors.push(`${at}: an uncommitted change has no commit message; save the request to a file and cite that`);
			}
		} else if (r.spec !== undefined) errors.push(`${at}: only a spec finding has spec`);
		if (r.location !== undefined) checkPlace(r.location, `${at}: location`, errors, { needDescription: false });
		if (r.evidence !== undefined) {
			if (!Array.isArray(r.evidence) || r.evidence.length === 0) errors.push(`${at}: evidence must be a non-empty array`);
			else r.evidence.forEach((e, j) => checkPlace(e, `${at}: evidence ${j + 1}`, errors, { needDescription: true }));
		}
		const required = FIELDS[r.verdict];
		if (!required) return;
		for (const k of required) if (r[k] === undefined) errors.push(`${at}: ${r.verdict} needs ${k}`);
		for (const k of ALL_OPTIONAL) if (!required.includes(k) && r[k] !== undefined) errors.push(`${at}: ${r.verdict} must not have ${k}`);
		const unknown = Object.keys(r).filter((k) => !COMMON.includes(k) && !ALL_OPTIONAL.includes(k) && k !== "spec");
		if (unknown.length) errors.push(`${at}: unknown field(s): ${unknown.join(", ")}`);
		if (r.severity !== undefined && !SEVERITIES.includes(r.severity)) errors.push(`${at}: severity must be ${SEVERITIES.join(" | ")}`);
		if (r.kind !== undefined && !KINDS.includes(r.kind)) errors.push(`${at}: kind must be ${KINDS.join(" | ")}`);
		for (const k of ["observed", "fix", "control", "suggestion", "how_to_check", "reason", "found_by", "verified_by"]) if (r[k] !== undefined && !isText(r[k])) errors.push(`${at}: ${k} must be non-empty text`);
		if (r.blockers !== undefined && (!Array.isArray(r.blockers) || !r.blockers.length || !r.blockers.every(isText)))
			errors.push(`${at}: blockers must list at least one unresolved fact`);
		if (isText(r.found_by) && isText(r.verified_by)) {
			if (r.verified_by.startsWith("script:")) {
				if (!SCRIPT_SOURCES.test(r.source ?? "")) errors.push(`${at}: only guard, api-map, and verify-evidence findings can be verified by a script; ${r.source} needs an agent verifier`);
			} else if (r.verified_by === r.found_by) errors.push(`${at}: verified_by must differ from found_by (the finder cannot verify its own finding)`);
		}
	});
	return errors;
}

const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// returns (rel) => file text or null, from a folder or from a git revision of the project at root
export function sourceReader(root, ref) {
	const cache = new Map();
	if (!ref)
		return (rel) => {
			if (!cache.has(rel)) {
				const abs = path.join(root, rel);
				cache.set(rel, fs.existsSync(abs) && fs.statSync(abs).isFile() ? fs.readFileSync(abs, "utf8") : null);
			}
			return cache.get(rel);
		};
	const top = git(root, ["rev-parse", "--show-toplevel"]);
	if (top.status !== 0) throw new ConfigError(`--ref needs a git repository: ${root}`);
	if (git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).status !== 0) throw new ConfigError(`--ref: ${ref} is not a commit`);
	const prefix = toPosix(path.relative(fs.realpathSync.native(top.stdout.trim()), fs.realpathSync.native(root)));
	return (rel) => {
		if (!cache.has(rel)) {
			const r = git(root, ["show", `${ref}:${prefix ? prefix + "/" : ""}${toPosix(rel)}`, "--"]);
			cache.set(rel, r.status === 0 ? r.stdout : null);
		}
		return cache.get(rel);
	};
}

// every quoted excerpt must appear within EXCERPT_WINDOW lines of its cited line; sources must exist
// readBefore(commit, rel) gives a file as it was before commit, for a file that commit deleted
// readMessage(commit) gives a commit's message, for a spec quoted from it
export function checkGrounding(records, read, readBefore = () => null, readMessage = () => null) {
	const errors = [];
	const place = (p, where, commit) => {
		if (!p || !isText(p.file) || !Number.isInteger(p.line) || !isText(p.excerpt)) return;
		const text = read(p.file) ?? (isText(commit) && commit !== "worktree" ? readBefore(commit, p.file) : null);
		if (text === null) return errors.push(`${where}: ${p.file} does not exist in the reviewed code`);
		const lines = text.split(/\r?\n/);
		if (p.line > lines.length) return errors.push(`${where}: ${p.file} has ${lines.length} lines, not ${p.line}`);
		const from = Math.max(0, p.line - 1 - EXCERPT_WINDOW);
		const window = norm(lines.slice(from, p.line + EXCERPT_WINDOW).join("\n"));
		if (!window.includes(norm(p.excerpt))) errors.push(`${where}: the excerpt does not appear within ${EXCERPT_WINDOW} lines of ${p.file}:${p.line}`);
	};
	let guardRules;
	records.forEach((r, i) => {
		const at = `finding ${i + 1}${isText(r?.id) ? ` (${r.id})` : ""}`;
		place(r?.location, `${at}: location`, r?.commit);
		if (Array.isArray(r?.evidence)) r.evidence.forEach((e, j) => place(e, `${at}: evidence ${j + 1}`, r?.commit));
		const src = typeof r?.source === "string" ? r.source : "";
		if (src.startsWith("guard:")) {
			if (guardRules === undefined) {
				const text = read(".stack-agent/guard.config.json");
				try {
					guardRules = text === null ? null : new Set((JSON.parse(text).rules ?? []).map((x) => x.id));
				} catch {
					guardRules = null;
				}
			}
			if (guardRules && !guardRules.has(src.slice(6)) && !GUARD_BUILTIN_RULES.includes(src.slice(6))) errors.push(`${at}: ${src} is not a rule in .stack-agent/guard.config.json`);
		}
		if (src === "spec" && isText(r?.spec?.quote) && isText(r?.spec?.from)) {
			const text = r.spec.from === SPEC_FROM_COMMIT ? (isText(r.commit) && r.commit !== "worktree" ? readMessage(r.commit) : null) : read(r.spec.from);
			if (text === null) errors.push(`${at}: the spec it quotes (${r.spec.from}) cannot be read`);
			else if (!norm(text).includes(norm(r.spec.quote))) errors.push(`${at}: spec.quote does not appear in ${r.spec.from === SPEC_FROM_COMMIT ? `the message of commit ${r.commit}` : r.spec.from}`);
		}
		const ruleLine = /^rules\.md:(\d+)$/.exec(src);
		const std = STANDARDS_RE.exec(src);
		const [file, line] = ruleLine ? [".stack-agent/rules.md", ruleLine[1]] : std ? [toPosix(std[1]), std[2]] : [];
		if (file) {
			const text = read(file);
			if (text === null) errors.push(`${at}: ${src} cites ${file}, which does not exist`);
			else if (Number(line) < 1 || Number(line) > text.split(/\r?\n/).length) errors.push(`${at}: ${src} is past the end of ${file}`);
		}
	});
	return errors;
}

// a final file must answer every candidate once, and only those: a dropped candidate would vanish from the log
export function checkCoverage(records, candidates) {
	if (!Array.isArray(records) || !Array.isArray(candidates)) return [];
	const wanted = new Set(candidates.map((c) => c?.id));
	const got = new Set(records.map((r) => r?.id));
	return [
		...[...wanted].filter((id) => !got.has(id)).map((id) => `candidate ${id} has no final record (record it as needs_validation if it was not verified)`),
		...[...got].filter((id) => !wanted.has(id)).map((id) => `finding ${id} is not one of the candidates`),
	];
}

// A finding about commit X must point at code X changed: its location or one evidence entry is in a file X touched.
// Otherwise a review of X reports problems that were already there (or came later), which a checkout of X also shows.
// Skipped for `worktree` findings and outside a git repository.
// the project's folder inside its git repository ("" at the top), or null outside git
function repoPrefix(root) {
	const top = git(root, ["rev-parse", "--show-toplevel"]);
	return top.status === 0 ? toPosix(path.relative(fs.realpathSync.native(top.stdout.trim()), fs.realpathSync.native(root))) : null;
}

// a cited path as git names it from the repository top; case-insensitive where the file system is
function repoPath(prefix, file) {
	const rel = path.posix.normalize(toPosix(file));
	const full = prefix ? `${prefix}/${rel}` : rel;
	return process.platform === "win32" ? full.toLowerCase() : full;
}

// a file as it was in the first parent of commit, when commit itself no longer has it
export function deletedReader(root) {
	const prefix = repoPrefix(root);
	if (prefix === null) return () => null;
	return (commit, rel) => {
		if (git(root, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]).status !== 0) return null;
		const name = `${prefix ? prefix + "/" : ""}${path.posix.normalize(toPosix(rel))}`;
		if (git(root, ["cat-file", "-e", `${commit}:${name}`]).status === 0) return null;
		const r = git(root, ["show", `${commit}^1:${name}`, "--"]);
		return r.status === 0 ? r.stdout : null;
	};
}

export function messageReader(root) {
	return (commit) => {
		if (git(root, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]).status !== 0) return null;
		const r = git(root, ["log", "-1", "--format=%B", commit]);
		return r.status === 0 ? r.stdout : null;
	};
}

export function checkChangedFiles(records, root) {
	const prefix = repoPrefix(root);
	if (prefix === null) return [];
	const changed = new Map();
	const filesOf = (commit) => {
		if (!changed.has(commit)) {
			const ok = git(root, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]).status === 0;
			const r = ok && git(root, ["diff-tree", "--root", "-r", "--no-commit-id", "--name-only", "-z", "--diff-merges=first-parent", commit]);
			changed.set(commit, ok && r.status === 0 ? new Set(r.stdout.split("\0").filter(Boolean).map((f) => repoPath("", f))) : null);
		}
		return changed.get(commit);
	};
	const errors = [];
	records.forEach((r, i) => {
		if (!isText(r?.commit) || r.commit === "worktree") return;
		const at = `finding ${i + 1}${isText(r?.id) ? ` (${r.id})` : ""}`;
		const files = filesOf(r.commit);
		if (!files) return errors.push(`${at}: commit ${r.commit} is not in this repository`);
		const places = [r.location, ...(Array.isArray(r.evidence) ? r.evidence : [])].filter((p) => isText(p?.file));
		if (places.length && !places.some((p) => files.has(repoPath(prefix, p.file))))
			errors.push(`${at}: neither the location nor any evidence cites a file commit ${r.commit.slice(0, 12)} changed (paths are relative to the project root); cite the changed line that causes it, or drop it from this commit's review`);
	});
	return errors;
}

export function validateFindings(records, { stage = "final", root = process.cwd(), ref, candidates } = {}) {
	const errors = checkRecords(records, { stage });
	if (Array.isArray(records) && records.length <= MAX_RECORDS) errors.push(...checkGrounding(records, sourceReader(root, ref), deletedReader(root), messageReader(root)), ...checkChangedFiles(records, root));
	if (candidates) errors.push(...checkCoverage(records, candidates));
	return errors;
}

const cell = (s) => printable(String(s).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim());

// one review-log row per final finding; a repeatable finding waits for /stack-agent:correct to prove a rule
export function logRows(records, date) {
	return records.map((r) => {
		const action =
			r.verdict === "confirmed"
				? r.kind === "repeatable"
					? `repeatable (${r.severity}): to /stack-agent:correct`
					: `one-off (${r.severity}): ${r.fix}`
				: r.verdict === "hardening"
					? `hardening (already stopped by ${r.control}): ${r.suggestion}`
					: r.verdict === "rejected"
						? `dismissed: ${r.reason}`
					: `needs validation: ${r.blockers[0]}`;
		return `| ${date} | ${cell(String(r.commit).slice(0, 12))} | ${cell(`${r.title} (${r.location.file}:${r.location.line})`)} | ${cell(action)} |`;
	});
}

function readFindings(file) {
	if (!file) throw new ConfigError("a findings file is required");
	if (!fs.existsSync(file)) throw new ConfigError(`not found: ${file}`);
	if (fs.statSync(file).size > MAX_BYTES) throw new ConfigError(`${file} is over ${MAX_BYTES / 1024 / 1024} MB`);
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (err) {
		throw new ConfigError(`${file} is not valid JSON: ${err.message}`);
	}
}

export function main(argv) {
	const args = parseArgs(argv, { flags: ["json", "help"], options: ["stage", "root", "ref", "date", "candidates"] });
	if (args.help) return { code: 0, text: USAGE };
	const [command, file, ...rest] = args._;
	if (rest.length) throw new ConfigError(`unexpected argument ${rest[0]}`);
	if (command === "validate") {
		const stage = args.stage ?? "final";
		if (!["candidates", "final"].includes(stage)) throw new ConfigError("--stage must be candidates or final");
		const records = readFindings(file);
		const candidates = args.candidates === undefined ? undefined : readFindings(args.candidates);
		const all = validateFindings(records, { stage, root: path.resolve(args.root ?? process.cwd()), ref: args.ref, candidates });
		const errors = all.slice(0, MAX_ERRORS).map(printable);
		const more = all.length > MAX_ERRORS ? [`... and ${all.length - MAX_ERRORS} more`] : [];
		if (args.json) return { code: all.length ? 1 : 0, text: JSON.stringify({ ok: all.length === 0, count: Array.isArray(records) ? records.length : 0, errors: [...errors, ...more] }, null, 2) };
		return all.length
			? { code: 1, text: [...errors.map((e) => `  ${e}`), ...more, `review-findings: INVALID (${all.length} problem(s))`].join("\n") }
			: { code: 0, text: `review-findings: ok (${records.length} finding(s), ${stage})` };
	}
	if (command === "rows") {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date ?? "")) throw new ConfigError("rows needs --date YYYY-MM-DD");
		const records = readFindings(file);
		const errors = checkRecords(records, { stage: "final" });
		if (errors.length) throw new ConfigError(`${file} is not a valid final findings file; run validate first`);
		return { code: 0, text: logRows(records, args.date).join("\n") };
	}
	throw new ConfigError(command ? `unknown command ${command}` : "a command is required (validate or rows)");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		(code === 0 ? console.log : console.error)(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`review-findings: ${printable(err.message)}\n${USAGE}`);
		process.exitCode = 2;
	}
}
