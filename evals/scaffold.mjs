#!/usr/bin/env node
// Copies the sample backend into the current directory (the eval run dir), installs the
// Stack Agent tools with init.mjs, and commits a clean starting point so `git status` and the
// Stop hook see only the agent's changes. scripts/ab/run.mjs imports scaffold() for its run projects.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// example: a folder under examples/ (sample-backend unless a task names another)
// port: written into verify.json before the commit, so parallel or leftover servers never share a port
export function scaffold(target, root = defaultRoot, example = "sample-backend", { port } = {}) {
	if (path.resolve(target).startsWith(root)) throw new Error(`refusing to scaffold inside the Stack Agent repo: ${target}`);

	const sample = path.join(root, "examples", example);
	fs.cpSync(sample, target, {
		recursive: true,
		// sample-backend keeps local SQLite files in data/, and the eval starts from an empty, unmigrated database; other
		// examples keep committed input there (sample-generic's expenses CSV), so only database files are left out
		filter: (src) => !/[\\/]\.stack-agent[\\/](evidence|bin)([\\/]|$)/.test(src) && !/[\\/]__pycache__([\\/]|$)/.test(src) && !/^data[\\/].*\.(db|sqlite3?)(-wal|-shm|-journal)?$/i.test(path.relative(sample, src)),
	});
	execFileSync(process.execPath, [path.join(root, "scripts", "init.mjs"), target], { stdio: "ignore" });
	const verifyFile = path.join(target, ".stack-agent", "verify.json");
	if (port && fs.existsSync(verifyFile)) fs.writeFileSync(verifyFile, fs.readFileSync(verifyFile, "utf8").replaceAll("3999", String(port)));
	const git = (...args) => execFileSync("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: target, stdio: "ignore" });
	git("init", "-q");
	git("add", "-A");
	git("commit", "-qm", example);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) scaffold(process.cwd());
