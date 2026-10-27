// Task: set Stack Agent up from scratch in a library that has none, started by name as a user would. The eval
// sandbox cannot write files from the shell, so init.mjs cannot run there; this task runs a real session instead.
// Graded on what a teammate would check: `init --check` reports no unfinished setup, and verify and the guard pass
// when the grader runs them itself. Only the plugin arm means anything: without the plugin the command does not exist.
import fs from "node:fs";
import path from "node:path";
import { gitIn, repoRoot, sh } from "../lib.mjs";

export const name = "init-library";
export const example = "sample-library";
export const prompt = "/stack-agent:stack-agent-init";
export const primary = ["setupComplete", "verifyPasses", "guardOk"];

// the scaffold installs Stack Agent; take it back out, so the session starts from the library alone
export function setup(dir) {
	fs.rmSync(path.join(dir, ".stack-agent"), { recursive: true, force: true });
	fs.rmSync(path.join(dir, ".github"), { recursive: true, force: true });
	gitIn(dir, "add", "-A");
	gitIn(dir, "commit", "-qm", "the library before Stack Agent");
	gitIn(dir, "tag", "ab-start");
}

// the behavior to check is the setup itself: init --check run by the grader, not the agent's report
export function probe(dir) {
	const r = sh(process.execPath, [path.join(repoRoot, "scripts", "init.mjs"), ".", "--check"], dir);
	return { ok: r.status === 0, detail: (r.stdout + r.stderr).trim().split("\n").slice(-3).join(" | ").slice(0, 300), raw: r };
}

export async function grade(dir) {
	const node = (args) => sh(process.execPath, args, dir);
	const has = (rel) => fs.existsSync(path.join(dir, rel));
	const check = probe(dir).raw;
	const verify = has(".stack-agent/bin/verify.mjs") ? node([".stack-agent/bin/verify.mjs", "--no-against"]) : null;
	const guard = has(".stack-agent/bin/guard.mjs") ? node([".stack-agent/bin/guard.mjs"]) : null;
	let checks = [];
	try {
		checks = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8")).checks ?? [];
	} catch {}
	const pending = (check.stdout + check.stderr).split("\n").filter((l) => /^\s*(pending|outdated|missing)|EDIT ME/i.test(l));
	return {
		checks: {
			setupComplete: check.status === 0,
			verifyPasses: verify?.status === 0,
			guardOk: guard?.status === 0,
			workflow: has(".github/workflows/stack-agent.yml"),
		},
		details: {
			setupComplete: check.status === 0 ? "init --check: ok" : pending.slice(0, 4).join(" | ").slice(0, 300) || (check.stdout + check.stderr).trim().slice(-300),
			verifyPasses: verify ? (verify.stdout + verify.stderr).trim().split("\n").at(-1) : "no .stack-agent/bin/verify.mjs",
			checks: `${checks.length} check(s): ${checks.map((c) => c.name).join(", ")}`,
		},
	};
}
