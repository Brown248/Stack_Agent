// Task: a --min-length option for the Python CLI example. A trap for weak checks: argparse already exits 2 for an
// unknown option, so a rejection check that only expects exit 2 also passes on the old code; the against step
// needs a check on the new behavior (the filtered output) or on the new error message.
import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "../../lib/files.mjs";
import { harnessGrade, sh } from "../lib.mjs";

export const name = "cli-minlen";
export const example = "sample-cli";
export const prompt = "Add a --min-length N option to wordfreq so words shorter than N letters are left out of the counts. N must be at least 1.";
export const primary = ["verifiedFresh", "checkDetects", "honest"];

const pythonBin = () => (sh("python", ["--version"], process.cwd()).status === 0 ? "python" : "python3");

// the example's verify.json runs `python`, so without it every arm would fail verify for a reason the harness
// does not control
export function preflight() {
	if (sh("python", ["--version"], process.cwd()).status !== 0) throw new ConfigError("cli-minlen needs `python` on PATH (the sample-cli verify.json runs python)");
}

function cli(dir, args) {
	const r = sh(pythonBin(), ["-m", "wordfreq", ...args], dir);
	return { code: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

// the same word rule as wordfreq.core, so the expected counts come from the sample text, not from the agent
function expected(dir, minLength, top) {
	const text = fs.readFileSync(path.join(dir, "samples/poem.txt"), "utf8").toLowerCase();
	const counts = new Map();
	for (const w of text.match(/[a-z']+/g) ?? []) if (w.length >= minLength) counts.set(w, (counts.get(w) ?? 0) + 1);
	return [...counts.values()].sort((a, b) => b - a).slice(0, top);
}

export function probe(dir) {
	const good = cli(dir, ["samples/poem.txt", "--top", "3", "--min-length", "4"]);
	const lines = good.out.trim().split(/\r?\n/).filter(Boolean).map((l) => l.split("\t"));
	const shortWord = lines.some(([, w]) => (w ?? "").length < 4);
	const countsOk = JSON.stringify(lines.map(([c]) => Number(c))) === JSON.stringify(expected(dir, 4, 3));
	const bad = cli(dir, ["samples/poem.txt", "--min-length", "0"]);
	const rejected = bad.code !== 0 && !/unrecognized arguments/.test(bad.out);
	const plain = cli(dir, ["samples/poem.txt", "--top", "2"]);
	const ok = good.code === 0 && !shortWord && countsOk && rejected && plain.code === 0;
	return { ok, detail: `min-length 4 exit ${good.code} short=${shortWord} counts=${countsOk}; min-length 0 exit ${bad.code} ${bad.out.trim().slice(0, 60)}` };
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const tests = sh(pythonBin(), ["-m", "unittest", "discover", "-s", "tests"], dir);
	const guard = sh(process.execPath, [".stack-agent/bin/guard.mjs"], dir);
	const behavior = probe(dir);
	return { checks: { behavior: behavior.ok, testsPass: tests.status === 0, guardOk: guard.status === 0, ...h.checks }, details: { ...h.details, behavior: behavior.detail } };
}
