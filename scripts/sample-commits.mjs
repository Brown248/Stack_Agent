#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ConfigError, parseArgs, toPosix } from "./lib/files.mjs";

const USAGE = `usage: node sample-commits.mjs [--root DIR] [--range A..B] [--since WHEN] [--count N] [--seed S] [--log FILE] [--no-ledger] [--json]
  picks N commits (default 5) at random for a human to review, merges excluded
  the review log (.stack-agent/review-log.md) is the ledger: commits it lists as reviewed are not picked again, and
  commits that touch files no reviewed commit has touched are picked first; the rest fill any remaining places
  --log        the review log to read, relative to --root (default .stack-agent/review-log.md; a missing file means
               nothing is reviewed yet); with the ledger on, --seed repeats a pick only while the log is unchanged
  --no-ledger  ignore the review log and pick from every commit at random
  --range  git revision range to sample from (default: the current branch, HEAD)
  --since  only commits newer than WHEN, any date git understands (default "24 hours ago" when --range is not given)
  --seed   makes the pick reproducible; without it a seed is chosen and printed
exit codes: 0 sampled (even if nothing matched), 2 bad arguments or not a git repo`;

const DEFAULT_COUNT = 5;
const DEFAULT_SINCE = "24 hours ago";
const GUARD_FILES = ["guard-baseline.json", "guard.config.json"];
const DEFAULT_LOG = ".stack-agent/review-log.md";

function git(root, args, input) {
	const r = spawnSync("git", args, { cwd: root, encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });
	if (r.error) throw new ConfigError(`could not run git: ${r.error.message}`);
	return r;
}

function hashSeed(seed) {
	let h = 0x811c9dc5;
	for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

function mulberry32(a) {
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function pickIndexes(total, count, seed) {
	const idx = Array.from({ length: total }, (_, i) => i);
	if (count >= total) return idx;
	const rand = mulberry32(hashSeed(seed));
	for (let i = 0; i < count; i++) {
		const j = i + Math.floor(rand() * (total - i));
		[idx[i], idx[j]] = [idx[j], idx[i]];
	}
	return idx.slice(0, count).sort((a, b) => a - b);
}

export function isGuardFile(rel) {
	return GUARD_FILES.includes(rel.split("/").pop());
}

export function listCommits(root, { range, since }) {
	if (!fs.existsSync(root) || git(root, ["rev-parse", "--is-inside-work-tree"]).status !== 0) throw new ConfigError(`not a git repository: ${root}`);
	if (!range && git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]).status !== 0) return [];
	const args = ["log", "-z", "--no-merges", "--format=%H%x1f%an%x1f%ae%x1f%cI%x1f%s"];
	if (since) args.push(`--since=${since}`);
	args.push(range ?? "HEAD", "--");
	const r = git(root, args);
	if (r.status !== 0) throw new ConfigError(`git log ${range ?? "HEAD"} failed: ${r.stderr.trim()}`);
	return r.stdout
		.split("\0")
		.filter(Boolean)
		.map((rec) => {
			const [sha, name, email, date, subject] = rec.replace(/^\n/, "").split("\x1f");
			return { sha, author: `${name} <${email}>`, date, subject };
		});
}

function filesChanged(root, sha) {
	const r = git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "-z", sha]);
	if (r.status !== 0) throw new ConfigError(`git diff-tree ${sha} failed: ${r.stderr.trim()}`);
	return r.stdout.split("\0").filter(Boolean);
}

// files changed by each commit, in one git call however many commits there are
function filesOf(root, shas) {
	const out = new Map();
	if (!shas.length) return out;
	const r = git(root, ["log", "--no-walk=unsorted", "--stdin", "-z", "--name-only", "--format=%x01%H"], shas.join("\n") + "\n");
	if (r.status !== 0) throw new ConfigError(`git log failed: ${r.stderr.trim()}`);
	for (const rec of r.stdout.split("\x01").filter(Boolean)) {
		const [sha, ...files] = rec.split("\0");
		out.set(sha, files.map((f) => f.replace(/^\n/, "")).filter(Boolean));
	}
	return out;
}

// one log row as { commit, finding, action }; the first and last cells are Date and Action, so an unescaped | in a
// hand-written Finding or a missing closing pipe does not shift them
export function parseLogRow(line) {
	const t = line.trim();
	if (!t.startsWith("|")) return null;
	const cells = t.slice(1).replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim());
	if (cells.length < 3) return null;
	return { commit: cells[1], finding: cells.slice(2, -1).join(" | "), action: cells.at(-1) };
}

const NOT_REVIEWED = /^(not reviewed\b|reviewer output unusable\b)/i;

// Commits the review log records as reviewed: a row whose Commit cell names a commit and whose Finding and Action
// do not start with "not reviewed". The log is append-only and committed, so it doubles as the ledger.
export function reviewedCommits(root, logFile) {
	if (!fs.existsSync(logFile)) return { shas: new Set(), unknown: [] };
	const cells = new Set();
	for (const line of fs.readFileSync(logFile, "utf8").split(/\r?\n/)) {
		const row = parseLogRow(line);
		if (row && /^[0-9a-f]{7,40}$/i.test(row.commit) && !NOT_REVIEWED.test(row.finding) && !NOT_REVIEWED.test(row.action)) cells.add(row.commit.toLowerCase());
	}
	const shas = new Set();
	const unknown = [];
	if (cells.size) {
		const list = [...cells];
		const r = git(root, ["cat-file", "--batch-check"], list.map((c) => `${c}^{commit}`).join("\n") + "\n");
		r.stdout.split("\n").filter(Boolean).forEach((line, i) => {
			const [sha, type] = line.split(" ");
			if (type === "commit") shas.add(sha);
			else unknown.push(`${list[i]}${type === "ambiguous" ? " (ambiguous)" : ""}`);
		});
	}
	return { shas, unknown };
}

export function sampleCommits(root, { range, since, count, seed, logFile }) {
	const commits = listCommits(root, { range, since });
	const withFiles = (c, files) => ({ ...c, files, guardFiles: files.filter(isGuardFile) });
	if (!logFile) return { total: commits.length, ledger: null, sampled: pickIndexes(commits.length, count, seed).map((i) => withFiles(commits[i], filesChanged(root, commits[i].sha))) };
	const { shas, unknown } = reviewedCommits(root, logFile);
	const pending = commits.filter((c) => !shas.has(c.sha));
	const files = filesOf(root, [...new Set([...shas, ...pending.map((c) => c.sha)])]);
	// the log itself is bookkeeping: the commit that appends to it is not new code to review
	const logRel = git(root, ["rev-parse", "--show-prefix"]).stdout.trim() + toPosix(path.relative(root, logFile));
	const seen = new Set([...shas].flatMap((sha) => files.get(sha) ?? []));
	const pool = pending.filter((c) => !(files.get(c.sha) ?? []).every((f) => f === logRel) || !(files.get(c.sha) ?? []).length).map((c) => {
		const entry = withFiles(c, files.get(c.sha) ?? []);
		entry.unreviewedFiles = entry.files.filter((f) => !seen.has(f) && f !== logRel);
		return entry;
	});
	const fresh = pool.filter((c) => c.unreviewedFiles.length);
	const rest = pool.filter((c) => !c.unreviewedFiles.length);
	const first = pickIndexes(fresh.length, count, seed).map((i) => fresh[i]);
	const more = pickIndexes(rest.length, Math.max(0, count - first.length), `${seed}/rest`).map((i) => rest[i]);
	const order = new Map(commits.map((c, i) => [c.sha, i]));
	const sampled = [...first, ...more].sort((a, b) => order.get(a.sha) - order.get(b.sha));
	return { total: commits.length, ledger: { log: logFile, alreadyReviewed: commits.length - pending.length, logOnly: pending.length - pool.length, touchingUnreviewedFiles: fresh.length, unknownShas: unknown }, sampled };
}

function main(argv) {
	const args = parseArgs(argv, { flags: ["json", "help", "no-ledger"], options: ["root", "range", "since", "count", "seed", "log"] });
	if (args.help) return { code: 0, text: USAGE };
	if (args._.length) throw new ConfigError(`unexpected argument ${args._[0]}`);
	const count = args.count === undefined ? DEFAULT_COUNT : Number(args.count);
	if (!Number.isInteger(count) || count < 1) throw new ConfigError(`--count must be a positive integer, got ${args.count}`);
	for (const name of ["range", "since", "seed", "log"]) if (args[name] !== undefined && !args[name].trim()) throw new ConfigError(`--${name} must not be empty`);
	if (args.range?.startsWith("-")) throw new ConfigError(`--range must be a revision range like main..HEAD, got ${args.range}`);
	const root = path.resolve(args.root ?? process.cwd());
	const since = args.since ?? (args.range ? undefined : DEFAULT_SINCE);
	const seed = args.seed ?? crypto.randomBytes(4).toString("hex");
	if (args.log !== undefined && args["no-ledger"]) throw new ConfigError("give --log or --no-ledger, not both");
	const logFile = args["no-ledger"] ? undefined : path.resolve(root, args.log ?? DEFAULT_LOG);
	const { total, ledger, sampled } = sampleCommits(root, { range: args.range, since, count, seed, logFile });
	const flagged = sampled.filter((c) => c.guardFiles.length).length;

	if (args.json) return { code: 0, text: JSON.stringify({ range: args.range ?? "HEAD", since: since ?? null, count, seed, total, flagged, ledger, sampled }, null, 2) };

	const where = `${args.range ?? "HEAD"}${since ? ` since ${since}` : ""}`;
	const out = [`sample-commits: ${sampled.length} of ${total} commit(s) in ${where} (seed ${seed}, rerun with --seed ${seed}${ledger ? " and the review log as it is now" : ""} for the same pick)`];
	if (ledger)
		out.push(
			`ledger ${toPosix(path.relative(root, ledger.log)) || ledger.log}: ${ledger.alreadyReviewed} already reviewed (skipped), ${ledger.logOnly ? `${ledger.logOnly} only update the log (skipped), ` : ""}${ledger.touchingUnreviewedFiles} touch files no review has covered (picked first)`,
			...(ledger.unknownShas.length ? [`  note: ${ledger.unknownShas.length} logged commit(s) do not name one commit in this repository: ${ledger.unknownShas.slice(0, 5).join(", ")}`] : []),
		);
	for (const c of sampled) {
		out.push(`\n${c.sha.slice(0, 12)}  ${c.date}  ${c.author}\n  ${c.subject}`);
		out.push(`  files (${c.files.length}): ${c.files.join(", ") || "(none)"}`);
		if (c.unreviewedFiles?.length) out.push(`  not covered by any review yet (${c.unreviewedFiles.length}): ${c.unreviewedFiles.join(", ")}`);
		for (const f of c.guardFiles) out.push(`  !!! GUARD FILE CHANGED: ${f} -- check that the ratchet was not loosened and that a human approved it`);
	}
	if (total === 0) out.push("no commits matched; widen --since or pass --range");
	else if (!sampled.length) out.push("every commit in the window is already in the review log; widen --since or pass --range");
	if (flagged) out.push(`\n!!! ${flagged} sampled commit(s) changed guard config or baseline; review those first`);
	return { code: 0, text: out.join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		(code === 0 ? console.log : console.error)(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`sample-commits: error: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}

export { main };
