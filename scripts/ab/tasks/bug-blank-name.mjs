// Task: a bug report, not a feature. The service stopped trimming names, so a name of only spaces is stored. The bug
// is committed before the session starts, so a repro (check or test) the agent adds can be proven by the against step.
import { call, commonGrade, harnessGrade, plantBug, withServer } from "../lib.mjs";

export const name = "bug-blank-name";
export const prompt = 'Bug report: POST /items with {"name": "   "} (only spaces) returns 201 and stores a blank item. It should be refused with 400, like an empty name. Please find and fix it.';
export const primary = ["behavior", "checkDetects", "verifiedFresh"];

export function setup(dir) {
	plantBug(dir, [["src/modules/items/service.js", 'input.name.trim() : ""', 'input.name : ""']], "items: take the name as sent");
}

export function probe(dir) {
	return withServer(dir, async (base) => {
		const blank = await call(base, "POST", "/items", { name: "   " });
		const pen = await call(base, "POST", "/items", { name: "pen" });
		return { ok: blank.status === 400 && pen.status === 201, detail: `blank ${blank.status}, pen ${pen.status}` };
	});
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const { checks, details } = commonGrade(dir);
	const behavior = await probe(dir);
	return { checks: { behavior: behavior.ok, ...checks, ...h.checks }, details: { ...details, ...h.details, behavior: behavior.detail } };
}
