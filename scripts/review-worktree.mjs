#!/usr/bin/env node
// A checkout of one past commit for reviewing it. Read, Grep, and Glob only see the working tree, so a review of
// commit X must read a checkout of X, or every path:line points at today's code instead.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs } from "./lib/files.mjs";
import { createWorktree, removeWorktree } from "./verify.mjs";

const USAGE = `usage: node review-worktree.mjs add REV [--root DIR] [--json]
       node review-worktree.mjs remove TMP [--root DIR]
  add     checks out REV in a temp folder (git hooks off, node_modules linked in) and prints the project folder
          inside it; review that folder, then remove it
  remove  deletes a folder that add printed (links are removed first, the linked folders are left alone); it refuses
          any other folder
exit codes: 0 ok, 2 usage error or the checkout failed`;

export const REVIEW_PREFIX = "stack-agent-review-";

export function main(argv) {
	const args = parseArgs(argv, { flags: ["json", "help"], options: ["root"] });
	if (args.help) return { code: 0, text: USAGE };
	const [command, target, ...rest] = args._;
	if (rest.length) throw new ConfigError(`unexpected argument ${rest[0]}`);
	const root = path.resolve(args.root ?? process.cwd());
	if (command === "add") {
		if (!target) throw new ConfigError("add needs a revision");
		const made = createWorktree(root, target, { prefix: REVIEW_PREFIX });
		if (made.error) {
			if (made.tmp) removeWorktree(made.top, made.tmp, []);
			throw new ConfigError(made.error);
		}
		const out = { tmp: made.tmp, root: made.wtRoot, rev: target };
		return { code: 0, text: args.json ? JSON.stringify(out, null, 2) : `review worktree for ${target}: ${made.wtRoot}\nremove it with: node review-worktree.mjs remove "${made.tmp}"` };
	}
	if (command === "remove") {
		const tmp = target && path.resolve(target);
		// only a folder that add made: the prefix plus the no-hooks and wt folders inside it
		if (!tmp || !path.basename(tmp).startsWith(REVIEW_PREFIX) || !fs.existsSync(path.join(tmp, "no-hooks")) || !fs.existsSync(path.join(tmp, "wt")))
			throw new ConfigError(`remove takes a folder that add printed (named ${REVIEW_PREFIX}..., with no-hooks and wt inside)`);
		removeWorktree(path.resolve(root), tmp, []);
		return { code: 0, text: `removed ${target}` };
	}
	throw new ConfigError(command ? `unknown command ${command}` : "a command is required (add or remove)");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		(code === 0 ? console.log : console.error)(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`review-worktree: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
