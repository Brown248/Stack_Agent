import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORE = ["node_modules", ".git", "dist", "build", "coverage", ".stack-agent/evidence", ".stack-agent/bin"];

export function toPosix(p) {
	return p.split(path.sep).join("/");
}

export function globToRegExp(glob) {
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
