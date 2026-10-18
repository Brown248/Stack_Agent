#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { ConfigError, parseArgs } from "./lib/files.mjs";

const USAGE = `usage: node sample-commits.mjs [--root DIR] [--range A..B] [--since WHEN] [--count N] [--seed S] [--json]
  picks N commits (default 5) at random for a human to review, merges excluded
  --range  git revision range to sample from (default: the current branch, HEAD)
  --since  only commits newer than WHEN, any date git understands (default "24 hours ago" when --range is not given)
  --seed   makes the pick reproducible; without it a seed is chosen and printed
exit codes: 0 sampled (even if nothing matched), 2 bad arguments or not a git repo`;

const DEFAULT_COUNT = 5;
const DEFAULT_SINCE = "24 hours ago";
const GUARD_FILES = ["guard-baseline.json", "guard.config.json"];

function git(root, args) {
	const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
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

export function sampleCommits(root, { range, since, count, seed }) {
	const commits = listCommits(root, { range, since });
	return {
		total: commits.length,
		sampled: pickIndexes(commits.length, count, seed).map((i) => {
			const files = filesChanged(root, commits[i].sha);
			return { ...commits[i], files, guardFiles: files.filter(isGuardFile) };
		}),
	};
}

function main(argv) {
	const args = parseArgs(argv, { flags: ["json", "help"], options: ["root", "range", "since", "count", "seed"] });
	if (args.help) return { code: 0, text: USAGE };
	if (args._.length) throw new ConfigError(`unexpected argument ${args._[0]}`);
	const count = args.count === undefined ? DEFAULT_COUNT : Number(args.count);
	if (!Number.isInteger(count) || count < 1) throw new ConfigError(`--count must be a positive integer, got ${args.count}`);
	for (const name of ["range", "since", "seed"]) if (args[name] !== undefined && !args[name].trim()) throw new ConfigError(`--${name} must not be empty`);
	if (args.range?.startsWith("-")) throw new ConfigError(`--range must be a revision range like main..HEAD, got ${args.range}`);
	const root = path.resolve(args.root ?? process.cwd());
	const since = args.since ?? (args.range ? undefined : DEFAULT_SINCE);
	const seed = args.seed ?? crypto.randomBytes(4).toString("hex");
	const { total, sampled } = sampleCommits(root, { range: args.range, since, count, seed });
	const flagged = sampled.filter((c) => c.guardFiles.length).length;

	if (args.json) return { code: 0, text: JSON.stringify({ range: args.range ?? "HEAD", since: since ?? null, count, seed, total, flagged, sampled }, null, 2) };

	const where = `${args.range ?? "HEAD"}${since ? ` since ${since}` : ""}`;
	const out = [`sample-commits: ${sampled.length} of ${total} commit(s) in ${where} (seed ${seed}, rerun with --seed ${seed} for the same pick)`];
	for (const c of sampled) {
		out.push(`\n${c.sha.slice(0, 12)}  ${c.date}  ${c.author}\n  ${c.subject}`);
		out.push(`  files (${c.files.length}): ${c.files.join(", ") || "(none)"}`);
		for (const f of c.guardFiles) out.push(`  !!! GUARD FILE CHANGED: ${f} -- check that the ratchet was not loosened and that a human approved it`);
	}
	if (total === 0) out.push("no commits matched; widen --since or pass --range");
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
