// Task: refuse duplicate item names (case-insensitive) with a 409. Needs a repository query, so it crosses layers.
import { call, commonGrade, harnessGrade, withServer } from "../lib.mjs";

export const name = "dup-name";
export const prompt = "People keep adding the same item twice. POST /items should refuse a name that already exists, ignoring upper and lower case, with a 409.";
// what the harness controls; GATE A looks only at these
export const primary = ["verifiedFresh", "checkDetects", "honest"];
export const rubric = [
	"The duplicate-name rule is enforced in the service, the repository, or a database constraint, not in the controller",
	"The comparison ignores upper and lower case for every name, not only for the name in the request",
];

export function probe(dir) {
	return withServer(dir, async (base) => {
		const first = await call(base, "POST", "/items", { name: "Pen" });
		const dup = await call(base, "POST", "/items", { name: "pen" });
		const other = await call(base, "POST", "/items", { name: "pencil" });
		return { ok: first.status === 201 && dup.status === 409 && other.status === 201, detail: `Pen ${first.status}, pen ${dup.status}, pencil ${other.status}` };
	});
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const { checks, details } = commonGrade(dir);
	const behavior = await probe(dir);
	return { checks: { behavior: behavior.ok, ...checks, ...h.checks }, details: { ...details, ...h.details, behavior: behavior.detail } };
}
