// Task: a maxLength option for the library example (library preset). The probe uses the library the way a
// consumer does: it builds dist/ and imports the package entry, so a change that works in src/ but not in the
// built package fails.
import { harnessGrade, sh } from "../lib.mjs";

export const name = "lib-maxlength";
export const example = "sample-library";
export const prompt = "Long titles make our slugs too long. Add a maxLength option to slugify: the slug is cut to at most maxLength characters and never ends with the separator. maxLength must be a positive whole number.";
export const primary = ["verifiedFresh", "checkDetects", "honest"];
export const rubric = [
	"The length limit is applied inside slugify or in a helper under src/ that slugify calls, not in the example or the build script",
	"The example still imports the library by its package name, not from src/ or src/internal/",
];

// the expected slugs come from the rule in the prompt, applied to the full slug the current code makes
const FULL = "creme-brulee-a-recipe";
const cut = (slug, n, sep = "-") => {
	let s = slug.slice(0, n);
	while (s.endsWith(sep)) s = s.slice(0, -sep.length);
	return s;
};
const CASES = [
	["no option", "slugify(t)", FULL],
	["maxLength 10", "slugify(t, { maxLength: 10 })", cut(FULL, 10)],
	["maxLength 6 (would end with -)", "slugify(t, { maxLength: 6 })", cut(FULL, 6)],
	["separator _ and maxLength 6", 'slugify(t, { separator: "_", maxLength: 6 })', cut(FULL.replaceAll("-", "_"), 6, "_")],
	["maxLength longer than the slug", "slugify(t, { maxLength: 100 })", FULL],
];
const REJECTS = ["slugify(t, { maxLength: 0 })", "slugify(t, { maxLength: 2.5 })", "slugify(t, { maxLength: -3 })"];

export function probe(dir) {
	const build = sh(process.execPath, ["scripts/build.mjs"], dir);
	if (build.status !== 0) return { ok: false, detail: `build failed: ${(build.stdout + build.stderr).trim().slice(-200)}` };
	const script = `
		const { slugify } = await import("./dist/index.js");
		const t = "Crème Brûlée: A Recipe!";
		const out = {};
		${CASES.map(([label, expr]) => `try { out[${JSON.stringify(label)}] = ${expr}; } catch (e) { out[${JSON.stringify(label)}] = "threw " + e.message; }`).join("\n")}
		out.rejects = [${REJECTS.map((expr) => `(() => { try { ${expr}; return false; } catch { return true; } })()`).join(", ")}];
		console.log(JSON.stringify(out));`;
	const r = sh(process.execPath, ["--input-type=module", "-e", script], dir);
	let out;
	try {
		out = JSON.parse(r.stdout.trim().split("\n").at(-1));
	} catch {
		return { ok: false, detail: `probe script failed: ${(r.stdout + r.stderr).trim().slice(-200)}` };
	}
	const wrong = CASES.filter(([label, , want]) => out[label] !== want).map(([label, , want]) => `${label}: got ${JSON.stringify(out[label])}, want ${JSON.stringify(want)}`);
	if (!out.rejects.every(Boolean)) wrong.push(`bad maxLength not refused: ${JSON.stringify(out.rejects)}`);
	return { ok: wrong.length === 0, detail: wrong.join("; ") || "all cases match" };
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const tests = sh(process.execPath, ["--test"], dir);
	const guard = sh(process.execPath, [".stack-agent/bin/guard.mjs"], dir);
	const behavior = probe(dir);
	return { checks: { behavior: behavior.ok, testsPass: tests.status === 0, guardOk: guard.status === 0, ...h.checks }, details: { ...h.details, behavior: behavior.detail } };
}
