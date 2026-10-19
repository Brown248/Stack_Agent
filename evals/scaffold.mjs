#!/usr/bin/env node
// Copies the sample backend into the current directory (the eval run dir), installs the
// Stack Agent tools with init.mjs, and commits a clean starting point so `git status` and the
// Stop hook see only the agent's changes. scripts/ab/run.mjs imports scaffold() for its run projects.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function scaffold(target, root = defaultRoot) {
	if (path.resolve(target).startsWith(root)) throw new Error(`refusing to scaffold inside the Stack Agent repo: ${target}`);

	const sample = path.join(root, "examples", "sample-backend");
	fs.cpSync(sample, target, {
		recursive: true,
		// data/ holds local SQLite files; the eval starts from an empty, unmigrated database.
		filter: (src) => !/[\\/]\.stack-agent[\\/](evidence|bin)([\\/]|$)/.test(src) && !/^data([\\/]|$)/.test(path.relative(sample, src)),
	});
	execFileSync(process.execPath, [path.join(root, "scripts", "init.mjs"), target], { stdio: "ignore" });
	const git = (...args) => execFileSync("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: target, stdio: "ignore" });
	git("init", "-q");
	git("add", "-A");
	git("commit", "-qm", "sample backend");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) scaffold(process.cwd());
