// skill-scan runs SkillSpector over every skill, the agents, hooks.json, and the hook scripts, one target at a time,
// with each target's baseline. A fake scanner stands in, so npm test needs no Python.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main, scanArgs, targets } from "../scripts/skill-scan.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { repoRoot, tempDir, write } from "./helpers.mjs";

function plugin() {
	const root = tempDir("stack-agent-scan-");
	write(root, "skills/alpha/SKILL.md", "# alpha\n");
	write(root, "skills/beta/SKILL.md", "# beta\n");
	write(root, "skills/notes/README.md", "not a skill\n");
	write(root, "agents/a.md", "# agent\n");
	write(root, "hooks/hooks.json", "{}\n");
	write(root, "scripts/hooks/h.mjs", "\n");
	write(root, ".github/skillspector/skill-beta.baseline.json", "{}\n");
	return root;
}

// the fake: records its arguments, and exits as a file next to the target says (default 0)
const fake = (root) => {
	const file = path.join(root, "fake-skillspector.mjs");
	fs.writeFileSync(
		file,
		`import fs from "node:fs"; import path from "node:path";
const target = process.argv[3];
fs.appendFileSync(${JSON.stringify(path.join(root, "calls.log"))}, JSON.stringify(process.argv.slice(2)) + "\\n");
const exit = path.join(target, "EXIT");
if (fs.existsSync(exit)) { console.log("finding in " + path.basename(target)); process.exit(Number(fs.readFileSync(exit, "utf8"))); }
`,
	);
	return file;
};

test("targets are each skill with a SKILL.md, then agents, hooks, and the hook scripts; a baseline is passed when one exists", () => {
	const root = plugin();
	assert.deepEqual(targets(root), [
		["skill-alpha", "skills/alpha"],
		["skill-beta", "skills/beta"],
		["agents", "agents"],
		["hooks", "hooks"],
		["scripts-hooks", "scripts/hooks"],
	]);
	const beta = scanArgs(root, ["skill-beta", "skills/beta"]);
	assert.deepEqual(beta.args.slice(2), ["--no-llm", "--fail-on-findings", "--baseline", path.join(root, ".github/skillspector/skill-beta.baseline.json")]);
	assert.equal(scanArgs(root, ["skill-alpha", "skills/alpha"]).baseline, null);
	assert.match(main(["--root", root, "--list"]).text, /skills\/beta {2}\(baseline \.github\/skillspector\/skill-beta\.baseline\.json\)/);
});

test("every target is scanned statically, one at a time; a new finding fails with 1 and a scan error with 2", () => {
	const root = plugin();
	const bin = fake(root);
	const clean = main(["--root", root, "--bin", bin]);
	assert.equal(clean.code, 0, clean.text);
	assert.match(clean.text, /skill-scan: ok \(5 target\(s\)/);
	const calls = fs.readFileSync(path.join(root, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
	assert.equal(calls.length, 5);
	for (const c of calls) {
		assert.equal(c[0], "scan");
		assert.ok(c.includes("--no-llm"), "never sends files to a model");
		assert.ok(!c.includes("--recursive"), "a baseline cannot apply to a multi-skill scan");
	}

	write(root, "skills/alpha/EXIT", "1");
	const found = main(["--root", root, "--bin", bin]);
	assert.equal(found.code, 1);
	assert.match(found.text, /NEW FINDING {2}skills\/alpha\n {4}finding in alpha/);
	assert.match(found.text, /ok {11}skills\/beta/);

	write(root, "agents/EXIT", "2");
	assert.equal(main(["--root", root, "--bin", bin]).code, 2, "the worst outcome wins");
});

test("a scanner that cannot start, or nothing to scan, is a usage error; this repo has targets", () => {
	const root = plugin();
	assert.throws(() => main(["--root", root, "--bin", path.join(root, "no-such-skillspector")]), (e) => e instanceof ConfigError && /could not run/.test(e.message));
	assert.throws(() => main(["--root", tempDir("stack-agent-scan-")]), /nothing to scan/);
	const own = main(["--root", repoRoot, "--list"]).text;
	for (const t of ["skills/debug", "skills/verify", "agents", "hooks", "scripts/hooks"]) assert.match(own, new RegExp(`^${t.replace("/", "\\/")}`, "m"));
});

// a fake that can also scan to JSON and write a baseline: the findings are the ISSUES.json next to the target
const leftovers = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("stack-agent-rebaseline-")).length;
const fakeJson = (root) => {
	const file = path.join(root, "fake-json-skillspector.mjs");
	fs.writeFileSync(
		file,
		`import fs from "node:fs"; import path from "node:path";
const a = process.argv.slice(2);
const target = a[1];
const at = (flag) => a[a.indexOf(flag) + 1];
const issuesFile = path.join(target, "ISSUES.json");
const issues = fs.existsSync(issuesFile) ? JSON.parse(fs.readFileSync(issuesFile, "utf8")) : [];
if (a[0] === "scan") fs.writeFileSync(at("--output"), JSON.stringify({ issues }));
if (a[0] === "baseline") fs.writeFileSync(at("-o"), JSON.stringify({ version: 2, scanner_version: "2.12.0", rules: [], fingerprints: issues.map((x, n) => ({ hash: "sha256:new" + n, rule_id: fs.existsSync(path.join(target, "WRONG")) ? "XX9" : x.id, file: x.location.file, reason: at("--reason") })) }));
`,
	);
	return file;
};

test("--rebaseline writes the hash again when the findings are the same kinds and number, and each entry keeps its reason", () => {
	const root = plugin();
	const bin = fakeJson(root);
	const baseline = path.join(root, ".github/skillspector/skill-beta.baseline.json");
	fs.writeFileSync(
		baseline,
		JSON.stringify({ version: 2, scanner_version: "2.12.0", rules: [], fingerprints: [{ hash: "sha256:old0", rule_id: "TM1", file: "SKILL.md", reason: "reason one" }, { hash: "sha256:old1", rule_id: "TM1", file: "SKILL.md", reason: "reason two" }, { hash: "sha256:old2", rule_id: "LP3", file: "SKILL.md", reason: "reason three" }] }),
	);
	write(root, "skills/beta/ISSUES.json", JSON.stringify([{ id: "TM1", location: { file: "SKILL.md", start_line: 21 }, finding: "--skip-tests" }, { id: "LP3", location: { file: "SKILL.md", start_line: 1 } }, { id: "TM1", location: { file: "SKILL.md", start_line: 25 }, finding: "--skip-checks" }]));
	const r = main(["--root", root, "--bin", bin, "--rebaseline", "skill-beta"]);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /^rebaselined {2}skills\/beta: TM1 in SKILL.md line 21 "--skip-tests"; LP3 in SKILL.md line 1 ""; TM1 in SKILL.md line 25 "--skip-checks"$/);
	const next = JSON.parse(fs.readFileSync(baseline, "utf8"));
	assert.deepEqual(next.fingerprints.map((x) => x.hash), ["sha256:new0", "sha256:new1", "sha256:new2"], "the hashes are the scanner's new ones");
	assert.deepEqual(next.fingerprints.map((x) => [x.rule_id, x.reason]), [["TM1", "reason one"], ["LP3", "reason three"], ["TM1", "reason two"]], "reasons follow their rule id, in order");
	assert.ok(fs.readFileSync(baseline, "utf8").endsWith("\n"));
});

test("--rebaseline refuses a finding the baseline does not cover, a target without a baseline, and an unknown target", () => {
	const root = plugin();
	const bin = fakeJson(root);
	const baseline = path.join(root, ".github/skillspector/skill-beta.baseline.json");
	const left = leftovers();
	const before = JSON.stringify({ version: 2, scanner_version: "2.12.0", rules: [], fingerprints: [{ hash: "sha256:old0", rule_id: "TM1", file: "SKILL.md", reason: "r" }] });
	fs.writeFileSync(baseline, before);
	// one more finding than the baseline holds, or a different kind: nothing is written
	const at = (file, id = "TM1") => ({ id, location: { file } });
	// one more than the baseline holds, a different kind, none, or the same kind in another file: nothing is written
	for (const issues of [[at("SKILL.md"), at("SKILL.md")], [at("SKILL.md", "PI2")], [], [at("other.md")]]) {
		write(root, "skills/beta/ISSUES.json", JSON.stringify(issues));
		const r = main(["--root", root, "--bin", bin, "--rebaseline", "skill-beta"]);
		assert.equal(r.code, 1);
		assert.match(r.text, /^REFUSED {6}skills\/beta: the scan finds \[.*\] and the baseline holds \[SKILL\.md\|TM1\] \(file\|rule\); triage the difference first$/);
		assert.equal(fs.readFileSync(baseline, "utf8"), before, "the baseline is untouched");
	}
	assert.throws(() => main(["--root", root, "--bin", bin, "--rebaseline", "skill-alpha"]), (e) => e instanceof ConfigError && /skill-alpha has no baseline/.test(e.message));
	assert.throws(() => main(["--root", root, "--bin", bin, "--rebaseline", "skill-nope"]), (e) => e instanceof ConfigError && /no target skill-nope/.test(e.message));
	// a baseline the scanner writes that does not match its own scan is not used
	write(root, "skills/beta/ISSUES.json", JSON.stringify([at("SKILL.md")]));
	write(root, "skills/beta/WRONG", "");
	assert.throws(() => main(["--root", root, "--bin", bin, "--rebaseline", "skill-beta"]), (e) => e instanceof ConfigError && /does not match its own scan; nothing was changed/.test(e.message));
	assert.equal(fs.readFileSync(baseline, "utf8"), before);
	fs.rmSync(path.join(root, "skills/beta/WRONG"));
	// no key, a baseline that is not JSON or has no list: usage errors (exit 2), not "a new finding"
	assert.throws(() => main(["--root", root, "--bin", bin, "--rebaseline", ""]), (e) => e instanceof ConfigError && /needs a target key/.test(e.message));
	fs.writeFileSync(baseline, "not json");
	assert.throws(() => main(["--root", root, "--bin", bin, "--rebaseline", "skill-beta"]), (e) => e instanceof ConfigError && /cannot read/.test(e.message));
	fs.writeFileSync(baseline, JSON.stringify({ version: 2 }));
	assert.throws(() => main(["--root", root, "--bin", bin, "--rebaseline", "skill-beta"]), (e) => e instanceof ConfigError && /no fingerprints list/.test(e.message));
	// a run that stops on its second target still says which first targets were rewritten
	fs.writeFileSync(baseline, before);
	write(root, "skills/beta/ISSUES.json", JSON.stringify([at("SKILL.md")]));
	assert.throws(
		() => main(["--root", root, "--bin", bin, "--rebaseline", "skill-beta,skill-nope"]),
		(e) => e instanceof ConfigError && /no target skill-nope \(see --list\)\n.*rebaselined {2}skills\/beta: TM1 in SKILL\.md/.test(e.message),
	);
	assert.equal(leftovers(), left, "the scan folders made on the way are removed");
});

test("the CI job is pinned, static, and not a gate, and every baselined finding carries its reason", () => {
	// a Windows checkout may have CRLF line endings
	const ci = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8").replace(/\r\n/g, "\n");
	const job = ci.slice(ci.indexOf("\n  skill-scan:"));
	assert.ok(job.length > 20, "ci.yml has a skill-scan job");
	assert.match(job, /pip install "git\+https:\/\/github\.com\/NVIDIA\/skillspector@c7958a3268d9498644b22edb75d0f051bbc8cbfc"/, "pinned to the v2.12.0 commit, not a tag or a branch");
	assert.match(job, /- name: Scan skills, agents, and hooks\n {8}id: scan\n {8}continue-on-error: true/, "the scan step never fails the job");
	assert.doesNotMatch(job.split("\n    steps:")[0], /continue-on-error/, "not at the job level, where a finding would turn the check red");
	assert.doesNotMatch(job, /secrets\.|_API_KEY|INFERENCE_KEY/, "no model provider credentials: static only");
	const dir = path.join(repoRoot, ".github/skillspector");
	const keys = targets(repoRoot).map((t) => t[0]);
	for (const name of fs.readdirSync(dir)) {
		const key = name.replace(/\.baseline\.json$/, "");
		assert.ok(keys.includes(key), `${name} belongs to a target`);
		const b = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
		assert.equal(b.scanner_version, "2.12.0", `${name} was made by the pinned version`);
		for (const f of b.fingerprints) assert.match(f.reason, /^false positive \(\d{4}-\d{2}-\d{2}\): .{40,}/, `${name}: ${f.rule_id} needs a real reason`);
	}
});
