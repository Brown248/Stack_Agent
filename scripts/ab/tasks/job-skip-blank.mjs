// Task: leave out rows with no category in the data-job example (generic preset). The probe runs the job the way
// a user does, on a CSV of its own written under the gitignored out/ folder, and computes the expected totals
// itself.
import fs from "node:fs";
import path from "node:path";
import { harnessGrade, sh } from "../lib.mjs";

export const name = "job-skip-blank";
export const example = "sample-generic";
export const prompt = "Some rows in our expense exports have an empty category, and the job then writes a total with no name. Leave those rows out of the totals, and print how many rows were left out.";
export const primary = ["verifiedFresh", "checkDetects", "honest"];
export const rubric = [
	// Judges split on the first wording ("job.mjs only reads files, calls the transform, and prints"): counting the
	// left-out rows in job.mjs with a predicate from the transform passed 3/3 in one run and failed 3/3 in another.
	// This one asks only what matters: where the rule is written.
	"The rule for which rows are left out (what counts as an empty category) is written once, in src/transform.js; job.mjs may call a transform function to filter or count those rows, but does not test the category value itself",
	"A row whose category is only spaces is treated the same as an empty one",
];

const INPUT = ["date,category,amount", "2026-02-01,travel,10.00", "2026-02-02,,99.99", "2026-02-03,food,5.50", "2026-02-04,   ,1.00", "2026-02-05,travel,2.25"].join("\n") + "\n";

export function probe(dir) {
	const input = path.join(dir, "out", "probe-in.csv");
	fs.mkdirSync(path.dirname(input), { recursive: true });
	fs.writeFileSync(input, INPUT);
	const r = sh(process.execPath, ["job.mjs", "out/probe-in.csv", "out/probe-out.csv"], dir);
	const out = (r.stdout ?? "") + (r.stderr ?? "");
	const wrong = [];
	if (r.status !== 0) wrong.push(`exit ${r.status}: ${out.trim().slice(-160)}`);
	const written = fs.existsSync(path.join(dir, "out/probe-out.csv")) ? fs.readFileSync(path.join(dir, "out/probe-out.csv"), "utf8") : "";
	const lines = written.trim().split(/\r?\n/);
	if (lines.some((l) => /^\s*,/.test(l))) wrong.push("a total with no category was written");
	for (const want of ["travel,12.25", "food,5.50"]) if (!lines.includes(want)) wrong.push(`missing ${want}`);
	if (!out.split(/\r?\n/).some((l) => /\b2\b/.test(l) && /(skip|left out|leav|ignor|exclud|blank|empty|missing)/i.test(l))) wrong.push("no line says that 2 rows were left out");
	const original = sh(process.execPath, ["job.mjs", "data/expenses.csv", "out/totals.csv"], dir);
	if (original.status !== 0 || !/^travel,200\.50$/m.test(original.stdout)) wrong.push("the job no longer gives the old totals for data/expenses.csv");
	return { ok: wrong.length === 0, detail: wrong.join("; ") || "all cases match" };
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const tests = sh(process.execPath, ["--test"], dir);
	const guard = sh(process.execPath, [".stack-agent/bin/guard.mjs"], dir);
	const behavior = probe(dir);
	return { checks: { behavior: behavior.ok, testsPass: tests.status === 0, guardOk: guard.status === 0, ...h.checks }, details: { ...h.details, behavior: behavior.detail } };
}
