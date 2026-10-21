// Task: a bug report. The summary counts items through a repository helper that counts distinct names, so two items
// with the same name count as one. No existing check or test catches it; the bug is committed before the session.
import { call, commonGrade, harnessGrade, plantBug, withServer } from "../lib.mjs";

export const name = "bug-dup-count";
export const prompt = "Bug report: after adding two items with the same name, GET /reports/summary says itemCount is 1 instead of 2. Please find and fix it.";
export const primary = ["behavior", "checkDetects", "verifiedFresh"];

export function setup(dir) {
	plantBug(
		dir,
		[
			[
				"src/modules/items/repository.js",
				'export function listItems() {\n\treturn db().prepare("SELECT id, name FROM items ORDER BY id").all();\n}',
				'export function listItems() {\n\treturn db().prepare("SELECT id, name FROM items ORDER BY id").all();\n}\n\nexport function countItems() {\n\treturn db().prepare("SELECT COUNT(DISTINCT name) AS n FROM items").get().n;\n}',
			],
			["src/modules/reports/controller.js", 'import { listItems } from "../items/repository.js";', 'import { countItems } from "../items/repository.js";'],
			["src/modules/reports/controller.js", "listItems().length", "countItems()"],
		],
		"reports: count items in the database",
	);
}

export function probe(dir) {
	return withServer(dir, async (base) => {
		for (const n of ["pen", "pen", "mug"]) await call(base, "POST", "/items", { name: n });
		const r = await call(base, "GET", "/reports/summary");
		let count = null;
		try {
			count = JSON.parse(r.text).itemCount;
		} catch {}
		return { ok: r.status === 200 && count === 3, detail: `summary ${r.status}, itemCount ${count} (want 3)` };
	});
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const { checks, details } = commonGrade(dir);
	const behavior = await probe(dir);
	return { checks: { behavior: behavior.ok, ...checks, ...h.checks }, details: { ...details, ...h.details, behavior: behavior.detail } };
}
