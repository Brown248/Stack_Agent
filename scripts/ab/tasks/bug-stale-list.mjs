// Task: a bug report about a bug that shows up only sometimes. The items list is cached for 50 ms and creating an
// item does not clear the cache, so a list read right after a create can miss the new item, depending on how soon
// after the previous read it comes. It tests the debug skill's steps for a timing-dependent bug: measure how often
// the repro goes red and raise that rate before working on the cause. The bug is committed before the session.
import { call, commonGrade, harnessGrade, plantBug, withServer } from "../lib.mjs";

export const name = "bug-stale-list";
export const prompt = "Bug report: sometimes, right after I add an item with POST /items, GET /items does not list it yet; a moment later it shows up. It does not happen every time. Please find and fix it.";
export const primary = ["behavior", "checkDetects", "verifiedFresh"];

export function setup(dir) {
	plantBug(
		dir,
		[
			[
				"src/modules/items/service.js",
				"export function getItems() {\n\treturn listItems();\n}",
				"// the list is read on every page load; keep it for a moment instead of querying each time\nconst CACHE_MS = 50;\nlet cached = null;\n\nexport function getItems() {\n\tif (cached && Date.now() - cached.at < CACHE_MS) return cached.items;\n\tcached = { at: Date.now(), items: listItems() };\n\treturn cached.items;\n}",
			],
		],
		"items: cache the list briefly",
	);
}

// a create between two reads, many times: every read after a create must list the new item
export function probe(dir) {
	return withServer(dir, async (base) => {
		const misses = [];
		for (let i = 0; i < 20; i++) {
			await call(base, "GET", "/items");
			const name = `probe-${i}`;
			const created = await call(base, "POST", "/items", { name });
			const r = await call(base, "GET", "/items");
			let names = [];
			try {
				names = JSON.parse(r.text).items.map((x) => x.name);
			} catch {}
			if (created.status !== 201 || r.status !== 200 || !names.includes(name)) misses.push(i);
		}
		return { ok: misses.length === 0, detail: `${20 - misses.length}/20 reads after a create listed the new item` };
	});
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const { checks, details } = commonGrade(dir);
	const behavior = await probe(dir);
	return { checks: { behavior: behavior.ok, ...checks, ...h.checks }, details: { ...details, ...h.details, behavior: behavior.detail } };
}
