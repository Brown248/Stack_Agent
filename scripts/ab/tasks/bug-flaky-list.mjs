// Task: a bug report about a bug that really is random. The items list is served from two in-memory copies picked at
// random, refreshed from the database every 200 ms, and creating an item refreshes only the first copy; a read that
// lands on the second copy soon after a create misses the new item. A single read-create-read fails only some of the
// time, so a one-shot repro can pass on the buggy code. The bug is folded into the project's first commit, so the
// history does not point at it. It tests the debug skill's step for a bug that fails on some runs only: run the
// repro many times, report how often it goes red, and raise that rate before working on the cause.
import { call, commonGrade, harnessGrade, plantBug, repeatGrade, withServer } from "../lib.mjs";

export const name = "bug-flaky-list";
export const prompt = "Bug report: every now and then, right after I add an item with POST /items, GET /items does not list it; if I ask again it is usually there. It does not happen every time. Please find and fix it.";
export const primary = ["behavior", "checkDetects", "verifiedFresh"];

export function setup(dir) {
	plantBug(
		dir,
		[
			["src/modules/items/service.js", 'import { insertItem, listItems } from "./repository.js";', 'import { insertItem, listItems } from "./repository.js";\n\n// two read copies of the list, so a busy list page does not query the database on every request\nconst REFRESH_MS = 200;\nconst copies = [{ at: 0, items: [] }, { at: 0, items: [] }];\nfunction refresh(copy) {\n\tcopy.items = listItems();\n\tcopy.at = Date.now();\n}'],
			["src/modules/items/service.js", "\treturn { item: insertItem(name) };", "\tconst item = insertItem(name);\n\trefresh(copies[0]);\n\treturn { item };"],
			["src/modules/items/service.js", "export function getItems() {\n\treturn listItems();\n}", "export function getItems() {\n\tconst copy = copies[Math.floor(Math.random() * copies.length)];\n\tif (Date.now() - copy.at >= REFRESH_MS) refresh(copy);\n\treturn copy.items;\n}"],
		],
		"",
		{ hidden: true },
	);
}

// a create between two reads, many times: every read after a create must list the new item
export function probe(dir) {
	return withServer(dir, async (base) => {
		let misses = 0;
		const tries = 40;
		for (let i = 0; i < tries; i++) {
			await call(base, "GET", "/items");
			const name = `probe-${i}`;
			const created = await call(base, "POST", "/items", { name });
			const r = await call(base, "GET", "/items");
			let names = [];
			try {
				names = JSON.parse(r.text).items.map((x) => x.name);
			} catch {}
			if (created.status !== 201 || r.status !== 200 || !names.includes(name)) misses++;
		}
		return { ok: misses === 0, detail: `${tries - misses}/${tries} reads after a create listed the new item` };
	});
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const { checks, details } = commonGrade(dir);
	const behavior = await probe(dir);
	const r = repeatGrade(dir);
	return { checks: { behavior: behavior.ok, ...checks, ...h.checks, ...r.checks }, details: { ...details, ...h.details, ...r.details, behavior: behavior.detail } };
}
