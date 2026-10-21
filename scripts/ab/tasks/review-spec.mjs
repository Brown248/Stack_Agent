// Task: a sampling review of one commit whose message asks for a 400 on names over 50 characters while the code
// truncates them instead. Only the plugin arm can run it (the bare arm has no reviewer). Graded from the files the
// review leaves: a confirmed `spec` finding on the service, valid findings files, a log row, and no code change.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { plantBug, repoRoot } from "../lib.mjs";

export const name = "review-spec";
export const arms = ["full"];
// the review runs `git -C <checkout> diff` and reads a checkout of the commit in the system temp folder
export const allowedTools = ["Bash(git:*)", "Agent", "Task"];
export const addDirs = () => [os.tmpdir()];
export const prompt = "/stack-agent:sample-review Sample the latest commit (use --range HEAD~1..HEAD --count 1). Do the whole review and write the log.";
export const primary = ["specConfirmed", "findingsValid", "logged", "noCodeChange"];

export function setup(dir) {
	plantBug(
		dir,
		[["src/modules/items/service.js", 'if (!name) return { error: "name is required" };', 'if (!name) return { error: "name is required" };\n\tif (name.length > 50) return { item: insertItem(name.slice(0, 50)) };']],
		"items: reject names longer than 50 characters\n\nPOST /items must return 400 with an error when the name is longer than 50 characters.",
	);
}

// nothing to probe on the running app: a review changes no code
export function probe() {
	return { ok: null, detail: "review task" };
}

function findingsFiles(dir) {
	const root = path.join(dir, ".stack-agent/evidence/review");
	if (!fs.existsSync(root)) return [];
	return fs.readdirSync(root, { recursive: true }).filter((f) => String(f).endsWith(".findings.json")).map((f) => path.join(root, String(f)));
}

export async function grade(dir) {
	const files = findingsFiles(dir);
	const records = files.flatMap((f) => {
		try {
			return JSON.parse(fs.readFileSync(f, "utf8"));
		} catch {
			return [];
		}
	});
	const spec = records.filter((r) => r.source === "spec" && r.verdict === "confirmed" && /service\.js$/.test(r.location?.file ?? ""));
	const validator = path.join(repoRoot, "scripts", "review-findings.mjs");
	const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
	const valid = files.map((f) => spawnSync(process.execPath, [validator, "validate", f, "--ref", head], { cwd: dir, encoding: "utf8" }).status === 0);
	const log = path.join(dir, ".stack-agent/review-log.md");
	const logged = fs.existsSync(log) && fs.readFileSync(log, "utf8").includes(head.slice(0, 12));
	const changed = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" }).stdout.split("\n").filter(Boolean).map((l) => l.slice(3));
	const code = changed.filter((f) => !f.startsWith(".stack-agent/") && !f.startsWith("data/"));
	return {
		checks: { specConfirmed: spec.length > 0, findingsValid: files.length > 0 && valid.every(Boolean), logged, noCodeChange: code.length === 0 },
		details: { files: files.length, records: records.map((r) => `${r.verdict}:${r.source}`).join(", ") || "none", changed: code.join(", ") || "none" },
	};
}
