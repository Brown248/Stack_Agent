import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORE = [
	"node_modules",
	".git",
	"dist",
	"build",
	"coverage",
	"__pycache__",
	".venv",
	"venv",
	".tox",
	".pytest_cache",
	".mypy_cache",
	"target",
	".stack-agent/evidence",
	".stack-agent/bin",
];

// The path as the file system names it: symbolic links resolved and, on Windows, 8.3 short names (C:\Users\RUNNER~1)
// expanded to the long ones git reports (C:\Users\runneradmin). Comparing a path git printed with one a user or a
// temp folder gave only works once both went through this. For a path that does not exist yet, the nearest folder
// that does is resolved and the rest kept as written.
export function realPath(p) {
	const abs = path.resolve(p);
	let head = abs;
	const tail = [];
	for (;;) {
		try {
			return path.join(fs.realpathSync.native(head), ...tail);
		} catch {
			const parent = path.dirname(head);
			if (parent === head) return abs;
			tail.unshift(path.basename(head));
			head = parent;
		}
	}
}

export function toPosix(p) {
	return p.split(path.sep).join("/");
}

const globCache = new Map();

export function globToRegExp(glob) {
	let cached = globCache.get(glob);
	if (!cached) globCache.set(glob, (cached = compileGlob(glob)));
	return cached;
}

function compileGlob(glob) {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*") {
			if (glob[i + 1] === "*") {
				const slashAfter = glob[i + 2] === "/";
				re += slashAfter ? "(?:.*/)?" : ".*";
				i += slashAfter ? 2 : 1;
			} else {
				re += "[^/]*";
			}
		} else if (c === "?") {
			re += "[^/]";
		} else if (c === "{" && glob.indexOf("}", i) > i) {
			const end = glob.indexOf("}", i);
			re += "(?:" + glob.slice(i + 1, end).split(",").map((alt) => globToRegExp(alt).source.slice(1, -1)).join("|") + ")";
			i = end;
		} else if ("\\^$+.()|{}[]".includes(c)) {
			re += "\\" + c;
		} else {
			re += c;
		}
	}
	return new RegExp("^" + re + "$");
}

export function matchesAny(relPath, globs) {
	return (globs ?? []).some((g) => globToRegExp(g).test(relPath));
}

function isIgnored(rel, entry) {
	if (rel === entry || rel.startsWith(entry + "/")) return true;
	if (!entry.includes("/") && !entry.includes("*")) return rel.split("/").includes(entry);
	return matchesAny(rel, [entry]);
}

// true when a full scan with this ignore list would leave rel out, so a file named one by one is judged the same way
export function isSkipped(rel, ignore = []) {
	return [...DEFAULT_IGNORE, ...ignore].some((s) => isIgnored(rel, s));
}

export function walk(root, ignore = []) {
	const skip = [...DEFAULT_IGNORE, ...ignore];
	const out = [];
	const visit = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const abs = path.join(dir, entry.name);
			const rel = toPosix(path.relative(root, abs));
			if (skip.some((s) => isIgnored(rel, s))) continue;
			if (entry.isDirectory()) visit(abs);
			else if (entry.isFile()) out.push(rel);
		}
	};
	visit(root);
	return out.sort();
}

const gitIn = (root, args, input) => spawnSync("git", args, { cwd: root, encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 });

// The files git would commit under root (tracked, plus untracked ones not gitignored), so a gitignored .env or key
// file is judged the same way locally as in CI, where it does not exist. Outside a git repo, every file under root.
// One git call lists them. Nothing is stat'ed here (that, or git's own -d, costs more than the listing on a large
// repo): a reader checks that each path is a regular file when it opens it, which it does anyway, so a tracked file
// deleted from disk, a submodule, or a symbolic link is skipped there.
export function projectFiles(root, ignore = []) {
	const r = gitIn(root, ["ls-files", "-co", "--exclude-standard", "-z"]);
	if (r.error || r.status !== 0) return walk(root, ignore);
	const skip = [...DEFAULT_IGNORE, ...ignore];
	// a plain folder name matches any path segment; anything with a slash or a glob is matched as before
	const names = new Set(skip.filter((s) => !s.includes("/") && !s.includes("*")));
	const others = skip.filter((s) => !names.has(s));
	const out = [];
	for (const rel of new Set(r.stdout.split("\0").filter(Boolean))) {
		if (rel.split("/").some((seg) => names.has(seg))) continue;
		if (others.length && others.some((s) => isIgnored(rel, s))) continue;
		out.push(rel);
	}
	return out.sort();
}

// The subset of rels (posix, relative to root) that git ignores; empty outside a git repo.
export function gitIgnored(root, rels) {
	if (!rels.length) return new Set();
	const r = gitIn(root, ["check-ignore", "--stdin", "-z"], rels.join("\0") + "\0");
	if (r.error || (r.status !== 0 && r.status !== 1)) return new Set();
	return new Set(r.stdout.split("\0").filter(Boolean));
}

export class ConfigError extends Error {}

export function requireStringArray(value, where, { optional = false } = {}) {
	if (value === undefined && optional) return;
	if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) throw new ConfigError(`${where} must be an array of strings, e.g. ["src/db/**"]`);
}

export function readJson(file, what) {
	if (!fs.existsSync(file)) throw new ConfigError(`${what} not found: ${file}`);
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (err) {
		throw new ConfigError(`${what} is not valid JSON (${file}): ${err.message}`);
	}
}

export function parseArgs(argv, { flags = [], options = [], multi = [] } = {}) {
	const out = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) {
			out._.push(a);
			continue;
		}
		const name = a.slice(2);
		if (flags.includes(name)) out[name] = true;
		else if (options.includes(name)) {
			if (i + 1 >= argv.length) throw new ConfigError(`--${name} needs a value`);
			out[name] = argv[++i];
		} else if (multi.includes(name)) {
			out[name] = out[name] ?? [];
			while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[name].push(argv[++i]);
		} else throw new ConfigError(`unknown option --${name}`);
	}
	return out;
}
