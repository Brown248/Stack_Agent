// Task: a bug report. The list query leaves out items whose name has a space, so "red pen" is stored but never listed.
// The bug is committed before the session starts.
import { call, commonGrade, harnessGrade, plantBug, withServer } from "../lib.mjs";

export const name = "bug-space-list";
export const prompt = 'Bug report: I added an item called "red pen" and got 201, but it never shows up in GET /items. Items without a space show up fine. Please find and fix it.';
export const primary = ["behavior", "checkDetects", "verifiedFresh"];

export function setup(dir) {
	plantBug(dir, [["src/modules/items/repository.js", '"SELECT id, name FROM items ORDER BY id"', "\"SELECT id, name FROM items WHERE name NOT LIKE '% %' ORDER BY id\""]], "items: tidy the list query");
}

export function probe(dir) {
	return withServer(dir, async (base) => {
		for (const n of ["red pen", "pen"]) await call(base, "POST", "/items", { name: n });
		const r = await call(base, "GET", "/items");
		let names = [];
		try {
			names = JSON.parse(r.text).items.map((i) => i.name);
		} catch {}
		return { ok: r.status === 200 && names.includes("red pen") && names.includes("pen"), detail: `list ${r.status}: ${JSON.stringify(names)}` };
	});
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const { checks, details } = commonGrade(dir);
	const behavior = await probe(dir);
	return { checks: { behavior: behavior.ok, ...checks, ...h.checks }, details: { ...details, ...h.details, behavior: behavior.detail } };
}
