// Where a measuring session may run so that no memory file of the person running it reaches the model. Claude Code reads
// a CLAUDE.md from the working folder and from every folder above it, and from the user's own ~/.claude, whatever
// --setting-sources says; `--setting-sources project,local` only turns settings off. On Windows the system temp folder is
// inside the user's profile, so a CLAUDE.md in C:\Users\<name> reached every session started from it (found on the
// machine this was written on: an "agentic team" playbook, read by a routing session that was only asked about a flag).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NAMES = ["CLAUDE.md", "CLAUDE.local.md", path.join(".claude", "CLAUDE.md"), path.join(".claude", "CLAUDE.local.md")];

// the memory files a session started in `dir` would read: in dir and every folder above it, and the user's own
export function memoryFilesAbove(dir, { home = os.homedir() } = {}) {
	const found = [];
	let current = path.resolve(dir);
	for (;;) {
		for (const name of NAMES) {
			const file = path.join(current, name);
			if (fs.existsSync(file) && fs.statSync(file).isFile()) found.push(file);
		}
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const own = path.join(home, ".claude", "CLAUDE.md");
	if (!found.includes(own) && fs.existsSync(own)) found.push(own);
	return found;
}

// The note to print when a memory file still reaches the sessions, or null
export const memoryNote = (memory) => (memory.length ? `NOTE: every session also reads ${memory.length} memory file(s) of yours: ${memory.join(", ")}. They are part of what is measured. A file in or above the work folder can be left out with --work-dir on a folder outside it; ~/.claude/CLAUDE.md is read wherever the session runs.` : null);

// candidates in order of preference: the system temp folder, then places that are writable by everyone and are not in a
// profile (C:\Users\Public, C:\ProgramData, /tmp, /var/tmp)
export function defaultBases(env = process.env) {
	return [os.tmpdir(), env.PUBLIC, env.ProgramData, "/tmp", "/var/tmp"].filter(Boolean);
}

// a folder that already exists must be ours: in a place everyone can write (/tmp), another user may have made it first
// and put a CLAUDE.md into it later
const writable = (dir) => {
	try {
		fs.mkdirSync(dir, { recursive: true });
		fs.accessSync(dir, fs.constants.W_OK);
		if (typeof process.getuid === "function" && fs.statSync(dir).uid !== process.getuid()) return false;
		return true;
	} catch {
		return false;
	}
};

// { base, memory }: the first candidate with no memory file above it other than the user's own ~/.claude/CLAUDE.md (read
// wherever a session runs), else the writable one with the fewest, with the files it would read listed in `memory`. `requested` is a folder the person chose; it is used as it is.
export function pickWorkBase({ requested = null, candidates = defaultBases(), home = os.homedir(), name = "stack-agent-work", find = (dir) => memoryFilesAbove(dir, { home }) } = {}) {
	if (requested) {
		const base = path.resolve(requested);
		if (!writable(base)) throw new Error(`cannot write in ${base}`);
		return { base, memory: find(base) };
	}
	// the memory files are found from the path alone, so no folder is made for a candidate that is not used
	const options = candidates.map((c) => path.join(path.resolve(c), name)).map((base) => ({ base, memory: find(base) }));
	const own = path.join(home, ".claude", "CLAUDE.md");
	for (const o of options) if (o.memory.every((f) => f === own) && writable(o.base)) return o;
	const usable = options.filter((o) => writable(o.base)).sort((a, b) => a.memory.length - b.memory.length);
	if (usable.length) return usable[0];
	throw new Error("no writable folder for the sessions (try --work-dir)");
}
