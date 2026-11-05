#!/usr/bin/env node
// PreToolUse hook: refuses the git commands that destroy work or publish it. Plain Node, no dependencies, so it runs
// the same on macOS, Linux, and Windows (Bash and PowerShell tools alike). Reads the hook JSON on stdin; exit 2 with a
// message on stderr tells Claude the command was refused.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// git [global options] <subcommand> <arguments up to the next command separator>. The scan is over the raw text, so a
// command inside `bash -c "..."` or after `&&` is seen too.
const GLOBAL_OPTION = String.raw`(?:-C\s+\S+|-c\s+\S+|--git-dir[=\s]\S+|--work-tree[=\s]\S+|--namespace[=\s]\S+|--no-pager|--paginate|-p|--no-optional-locks|--no-replace-objects|--bare|--literal-pathspecs)`;
const GIT = new RegExp(String.raw`(?<![\w.-])git(?:\.exe)?((?:\s+${GLOBAL_OPTION})*)\s+(push|reset|clean|branch|checkout|restore)\b([^;&|\n]*)`, "g");

const RULES = {
	push: { name: "git push", test: () => true },
	reset: { name: "git reset --hard", test: (args) => /(?:^|\s)--hard\b/.test(args) },
	clean: { name: "git clean -f", test: (args) => /(?:^|\s)(?:-[a-zA-Z]*f[a-zA-Z]*|--force)\b/.test(args) },
	branch: { name: "git branch -D", test: (args) => /(?:^|\s)-[a-zA-Z]*D[a-zA-Z]*\b/.test(args) || (/(?:^|\s)(?:-d|--delete)\b/.test(args) && /(?:^|\s)(?:-f|--force)\b/.test(args)) },
	checkout: { name: "git checkout .", test: (args) => /(?:^|\s)\.(?:\s|$)/.test(args) },
	restore: { name: "git restore .", test: (args) => /(?:^|\s)\.(?:\s|$)/.test(args) },
};

// Returns the name of the first rule the command breaks, or null.
export function blocked(command) {
	for (const match of String(command ?? "").matchAll(GIT)) {
		const hit = RULES[match[2]];
		if (hit.test(match[3])) return hit.name;
	}
	return null;
}

function main() {
	let input = {};
	try {
		const raw = fs.readFileSync(0, "utf8");
		input = raw.trim() ? JSON.parse(raw) : {};
	} catch {
		// unreadable input: allow, like a hook that does not apply
	}
	const command = input?.tool_input?.command;
	const rule = blocked(command);
	if (!rule) return;
	process.stderr.write(`BLOCKED: '${command}' matches the dangerous git command '${rule}'. The user has prevented you from running it; ask them to run it themselves if it is needed.\n`);
	process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
