// Task: reject item names longer than 50 characters with a 400.
import fs from "node:fs";
import path from "node:path";
import { call, commonGrade, gitIn, testDiff, withServer } from "../lib.mjs";

export const name = "validate";
export const prompt = "Item names longer than 50 characters are breaking our reports. Make POST /items reject them with a 400.";

export function probe(dir) {
	return withServer(dir, async (base) => {
		const long = await call(base, "POST", "/items", { name: "x".repeat(51) });
		const edge = await call(base, "POST", "/items", { name: "y".repeat(50) });
		const normal = await call(base, "POST", "/items", { name: "pen" });
		return { ok: long.status === 400 && edge.status === 201 && normal.status === 201, detail: `51 chars ${long.status}, 50 chars ${edge.status}, normal ${normal.status}` };
	});
}

const coversRule = (c) => String(c.method ?? "").toUpperCase() === "POST" && /items/.test(c.path ?? "") && c.expectStatus === 400 && typeof c.body?.name === "string" && c.body.name.length > 50;

export async function grade(dir) {
	const { checks, details } = commonGrade(dir);
	const behavior = await probe(dir);
	const g = { behavior: behavior.ok, ...checks };
	details.behavior = behavior.detail;
	g.testAdded = /50|51|long/i.test(testDiff(dir));
	g.ruleInService = /\b(50|51)\b/.test(fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8"));
	const baseChecks = JSON.parse(gitIn(dir, "show", "HEAD:.stack-agent/verify.json")).checks;
	let curChecks = [];
	try {
		curChecks = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8")).checks ?? [];
	} catch {}
	const added = curChecks.filter((c) => !baseChecks.some((b) => b.name === c.name));
	const covering = added.filter(coversRule);
	details.newChecks = added.map((c) => c.name).join(", ") || "none";
	g.checkAdded = covering.length > 0;
	const latest = path.join(dir, ".stack-agent/evidence/latest.json");
	const steps = fs.existsSync(latest) ? JSON.parse(fs.readFileSync(latest, "utf8")).steps ?? [] : [];
	g.evidenceCoversRule = covering.some((c) => steps.some((s) => s.name === c.name && s.ok));
	return { checks: g, details };
}
