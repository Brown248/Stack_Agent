// The judge for the A/B harness: criteria a script cannot check ("the controller only parses the request") are
// scored by agents/judge.md, run as its own claude session on a blind copy of the run. The copy has a random name
// and leaves out what would tell the arm (verify evidence, the skip record, the Stack Agent configs), so the judge
// scores the code, not the harness. Opt in with run.mjs --judge MODEL: it costs a second session per run.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitIn, parseTranscript, usageOf } from "./lib.mjs";

// what the judge may see of .stack-agent/: the team rules it may be asked about
const KEEP_FROM_STACK_AGENT = new Set(["rules.md"]);
const SKIP_DIRS = new Set([".git", "node_modules", "data", "__pycache__"]);

export function judgeInstructions(pluginDir) {
	const text = fs.readFileSync(path.join(pluginDir, "agents", "judge.md"), "utf8").replace(/\r\n/g, "\n");
	return text.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
}

// the commit the agent started from: the planted bug's tag for a bug task, else the scaffold's first commit
export function baseCommit(dir) {
	const tag = spawnSync("git", ["rev-parse", "--verify", "--quiet", "ab-start^{commit}"], { cwd: dir, encoding: "utf8" });
	if (tag.status === 0) return tag.stdout.trim();
	return gitIn(dir, "rev-list", "--max-parents=0", "HEAD").trim().split("\n")[0];
}

// the change as a diff, untracked files included, without touching the project's own index
export function changeDiff(dir) {
	const index = path.join(os.tmpdir(), `stack-agent-judge-index-${crypto.randomBytes(6).toString("hex")}`);
	const env = { ...process.env, GIT_INDEX_FILE: index };
	try {
		spawnSync("git", ["read-tree", "HEAD"], { cwd: dir, env });
		spawnSync("git", ["add", "-A"], { cwd: dir, env });
		const r = spawnSync("git", ["diff", "--cached", baseCommit(dir), "--", ".", ":(exclude).stack-agent"], { cwd: dir, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
		return r.stdout ?? "";
	} finally {
		fs.rmSync(index, { force: true });
	}
}

// a copy of the run under a random name, with the change as CHANGES.diff; returns its folder
export function blindCopy(projectDir, outDir) {
	const dest = path.join(outDir, "judge", crypto.randomBytes(8).toString("hex"));
	fs.cpSync(projectDir, dest, {
		recursive: true,
		filter: (src) => {
			const rel = path.relative(projectDir, src).split(path.sep);
			if (rel[0] === "") return true;
			if (SKIP_DIRS.has(rel[0])) return false;
			if (rel[0] === ".stack-agent") return rel.length === 1 || (rel.length === 2 && KEEP_FROM_STACK_AGENT.has(rel[1]));
			return !rel.includes("node_modules") && !rel.includes("__pycache__");
		},
	});
	fs.writeFileSync(path.join(dest, "CHANGES.diff"), changeDiff(projectDir));
	return dest;
}

export function judgePrompt(rubric) {
	return [
		"Score Candidate A. Its files are in the current folder, and CHANGES.diff is the change it made, from the code it started with.",
		"Judge only the change in CHANGES.diff and the files it touches. Read the files themselves, not just the diff.",
		"Rubric:",
		...rubric.map((c, i) => `${i + 1}. ${c}`),
	].join("\n");
}

export function judgeArgs({ prompt, model, budget, instructions, isolate = true }) {
	const args = ["-p", prompt, "--model", model, "--max-budget-usd", String(budget), "--output-format", "stream-json", "--verbose", "--permission-mode", "default", "--allowedTools", "Read,Glob,Grep", "--append-system-prompt", instructions];
	if (isolate) args.push("--setting-sources", "project,local", "--strict-mcp-config");
	return args;
}

export const judgeKey = (criterion) => "judge:" + criterion.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

const norm = (s) => s.toLowerCase().replace(/[`*_]/g, "").replace(/\s+/g, " ").trim();

// The judge answers with a table "| Criterion | Verdict | Evidence |". Each rubric criterion gets true (PASS),
// false (FAIL), or null when the answer has no row for it, matched by its text, else by its position.
export function parseJudge(text, rubric) {
	const rows = [];
	for (const line of String(text ?? "").split("\n")) {
		const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
		if (cells.length < 2) continue;
		const verdict = /^\**(PASS|FAIL)\**$/i.exec(cells[1]);
		if (verdict) rows.push({ criterion: cells[0], pass: verdict[1].toUpperCase() === "PASS" });
	}
	const out = {};
	rubric.forEach((c, i) => {
		const byText = rows.find((r) => norm(r.criterion) === norm(c) || norm(r.criterion).replace(/^\d+\.\s*/, "") === norm(c));
		const row = byText ?? (rows.length === rubric.length ? rows[i] : undefined);
		out[judgeKey(c)] = row ? row.pass : null;
	});
	return out;
}

// runs the judge on a blind copy of one run; returns { grade, usage, text, folder }
export function runJudge({ claude, spawn, projectDir, outDir, rubric, model, budget, pluginDir, isolate, env }) {
	const folder = blindCopy(projectDir, outDir);
	const args = judgeArgs({ prompt: judgePrompt(rubric), model, budget, instructions: judgeInstructions(pluginDir), isolate });
	const r = spawn(claude, args, folder, env);
	const parsed = parseTranscript(r.stdout ?? "");
	const text = String(parsed.result?.result ?? "");
	return { grade: parseJudge(text, rubric), usage: usageOf(parsed), text: text.slice(0, 4000), folder };
}
