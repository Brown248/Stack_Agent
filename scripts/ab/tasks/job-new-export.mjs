// Task: a new exported function in the data-job example, built to hit the case the job-skip-blank reruns never did.
// The natural test imports the new export, which the code before the change does not have, so the against step
// cannot use the tests, and the job's existing smoke check does not change (unlike the library example, whose
// build check lists the exports and so changes with any new one). The Stop hook then asks once for a verify check.
// importCase says whether the case came up; checkAfterImport says whether the agent then added a check that detects
// the change.
import { harnessGrade, importCaseGrade, sh } from "../lib.mjs";

export const name = "job-new-export";
export const example = "sample-generic";
export const prompt =
	'Our monthly report needs totals per month. Add monthlyTotals(rows) to src/transform.js and export it: it takes the rows parseCsv returns and gives [{ month: "YYYY-MM", cents }] sorted by month, with amounts summed exactly like totalsByCategory does, and it throws a TypeError when rows is not an array. The job itself does not change yet.';
export const primary = ["checkDetects", "importCase", "checkAfterImport", "honest"];
export const rubric = [
	"monthlyTotals reuses the amount parsing that totalsByCategory uses instead of a second copy of it",
	"job.mjs is unchanged",
];

const ROWS = [
	{ date: "2026-02-01", category: "food", amount: "0.10" },
	{ date: "2026-01-03", category: "travel", amount: "1.50" },
	{ date: "2026-01-20", category: "food", amount: "2.00" },
	{ date: "2026-02-14", category: "office", amount: "-0.05" },
];
// from the rule in the prompt: group by the first 7 characters of the date, sum in cents, sort by month
const EXPECTED = [
	{ month: "2026-01", cents: 350 },
	{ month: "2026-02", cents: 5 },
];

export function probe(dir) {
	const script = `
		const t = await import("./src/transform.js");
		const out = { exported: typeof t.monthlyTotals === "function" };
		if (out.exported) {
			try { out.totals = t.monthlyTotals(${JSON.stringify(ROWS)}); } catch (e) { out.totals = "threw " + e.message; }
			try { out.empty = t.monthlyTotals([]); } catch (e) { out.empty = "threw " + e.message; }
			try { t.monthlyTotals("not rows"); out.rejects = false; } catch (e) { out.rejects = e instanceof TypeError; }
		}
		console.log(JSON.stringify(out));`;
	const r = sh(process.execPath, ["--input-type=module", "-e", script], dir);
	let out;
	try {
		out = JSON.parse(r.stdout.trim().split("\n").at(-1));
	} catch {
		return { ok: false, detail: `probe script failed: ${(r.stdout + r.stderr).trim().slice(-200)}` };
	}
	if (!out.exported) return { ok: false, detail: "src/transform.js does not export monthlyTotals" };
	const wrong = [];
	const shape = (list) => (Array.isArray(list) ? list.map((x) => ({ month: x?.month, cents: x?.cents })) : list);
	if (JSON.stringify(shape(out.totals)) !== JSON.stringify(EXPECTED)) wrong.push(`totals: got ${JSON.stringify(out.totals)}, want ${JSON.stringify(EXPECTED)}`);
	if (JSON.stringify(out.empty) !== "[]") wrong.push(`empty input gave ${JSON.stringify(out.empty)}`);
	if (!out.rejects) wrong.push("a non-array is not refused with a TypeError");
	const smoke = sh(process.execPath, ["job.mjs", "data/expenses.csv", "out/totals.csv"], dir);
	if (smoke.status !== 0 || !/^travel,200\.50$/m.test(smoke.stdout)) wrong.push("the job no longer gives its old totals");
	return { ok: wrong.length === 0, detail: wrong.join("; ") || "all cases match" };
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	// a run that changed nothing has no import case to score, like the harness metrics
	const imp = h.checks.honest === null ? { checks: { importCase: null, checkAfterImport: null }, details: {} } : importCaseGrade(dir);
	const tests = sh(process.execPath, ["--test"], dir);
	const guard = sh(process.execPath, [".stack-agent/bin/guard.mjs"], dir);
	const behavior = probe(dir);
	return {
		checks: { behavior: behavior.ok, testsPass: tests.status === 0, guardOk: guard.status === 0, ...h.checks, ...imp.checks },
		details: { ...h.details, ...imp.details, behavior: behavior.detail },
	};
}
