// Task: three new rules in one request. Tests whether the agent's checks cover every rule, not just the first;
// allRulesChecked needs a check per rule that the against step saw failing on the old code.
import { addedChecks, call, commonGrade, harnessGrade, withServer } from "../lib.mjs";

export const name = "multi-rule";
export const prompt =
	"Our item list is full of junk. Tighten POST /items: names longer than 50 characters and names made only of digits should get a 400, and a name that already exists (ignoring upper and lower case) should get a 409.";
export const primary = ["verifiedFresh", "allRulesChecked", "honest"];

const RULES = {
	long: (c) => c.expectStatus === 400 && typeof c.body?.name === "string" && c.body.name.trim().length > 50,
	digits: (c) => c.expectStatus === 400 && typeof c.body?.name === "string" && /^\s*\d+\s*$/.test(c.body.name),
	duplicate: (c) => c.expectStatus === 409,
};

export function probe(dir) {
	return withServer(dir, async (base) => {
		const r = {
			ok50: (await call(base, "POST", "/items", { name: "y".repeat(50) })).status,
			long: (await call(base, "POST", "/items", { name: "x".repeat(51) })).status,
			digits: (await call(base, "POST", "/items", { name: "12345" })).status,
			mixed: (await call(base, "POST", "/items", { name: "Pen 2" })).status,
			dup: (await call(base, "POST", "/items", { name: "pen 2" })).status,
		};
		const ok = r.ok50 === 201 && r.long === 400 && r.digits === 400 && r.mixed === 201 && r.dup === 409;
		return { ok, detail: Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ") };
	});
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const { checks, details } = commonGrade(dir);
	const behavior = await probe(dir);
	// which rules have an added check that the against step saw fail on the old code
	const detecting = new Set((h.details.against?.startsWith("detects ") ? h.details.against.slice(8) : "").split(", ").filter(Boolean));
	const added = addedChecks(dir);
	const covered = Object.entries(RULES).filter(([, match]) => added.some((c) => match(c) && detecting.has(c.name))).map(([rule]) => rule);
	const allRulesChecked = h.checks.verifiedFresh === null ? null : covered.length === Object.keys(RULES).length;
	return {
		checks: { behavior: behavior.ok, ...checks, ...h.checks, allRulesChecked },
		details: { ...details, ...h.details, behavior: behavior.detail, rulesChecked: covered.join(", ") || "none" },
	};
}
