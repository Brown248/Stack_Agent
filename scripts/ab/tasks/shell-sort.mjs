// Task: the user hands over a sed one-liner that works but breaks two guard rules (it puts a query and the db import
// in the controller). An edit through the shell is what the after-edit hook never saw; the after-shell hook should
// report it right after the command, and the agent should move the sorting where it belongs (the repository).
// shellHookFired reads the hook's own record of its reports (a transcript does not carry hook output); the bare arm
// has no hook, so it is not applicable there.
import fs from "node:fs";
import path from "node:path";
import { call, commonGrade, harnessGrade, withServer } from "../lib.mjs";

export const name = "shell-sort";
export const prompt = [
	"Our tech lead sent this one-liner so GET /items lists items sorted by name. Run it as is from the project root, then make sure everything still works:",
	"",
	`sed -i -e '1i import { db } from "../../db.js";' -e 's/getItems()/db().prepare("SELECT id, name FROM items ORDER BY name").all()/' src/modules/items/controller.js`,
].join("\n");
export const primary = ["behavior", "guardOk", "shellHookFired"];
export const allowedTools = ["Bash(sed:*)"];
export const rubric = ["The sorting lives in the repository or the service, not in the controller"];

export function probe(dir) {
	return withServer(dir, async (base) => {
		for (const name of ["pear", "apple", "fig"]) {
			const r = await call(base, "POST", "/items", { name });
			if (r.status !== 201) return { ok: false, detail: `POST ${name}: ${r.status}` };
		}
		const r = await call(base, "GET", "/items");
		let names = [];
		try {
			names = JSON.parse(r.text).items.map((x) => x.name);
		} catch {}
		const sorted = JSON.stringify(names) === JSON.stringify(["apple", "fig", "pear"]);
		return { ok: r.status === 200 && sorted, detail: `GET /items ${r.status}: ${JSON.stringify(names)}` };
	});
}

// the rules the after-shell guard reported in this project, from its session records
export function reportedRules(dir) {
	const sessions = path.join(dir, ".stack-agent/evidence/sessions");
	const rules = new Set();
	for (const f of fs.existsSync(sessions) ? fs.readdirSync(sessions).filter((n) => n.endsWith(".reports.log")) : [])
		for (const line of fs.readFileSync(path.join(sessions, f), "utf8").split("\n").filter(Boolean))
			try {
				for (const v of JSON.parse(line).violations ?? []) rules.add(v.rule);
			} catch {}
	return [...rules].sort();
}

export async function grade(dir, { arm } = {}) {
	const h = harnessGrade(dir);
	const { checks, details } = commonGrade(dir);
	const behavior = await probe(dir);
	const rules = reportedRules(dir);
	const fired = rules.includes("no-sql-in-controller") || rules.includes("controller-no-db");
	return {
		checks: { behavior: behavior.ok, ...checks, ...h.checks, shellHookFired: arm === "none" ? null : fired },
		details: { ...details, ...h.details, behavior: behavior.detail, reported: rules.join(", ") || "nothing" },
	};
}
