// skill-scan runs SkillSpector over every skill, the agents, hooks.json, and the hook scripts, one target at a time,
// with each target's baseline. A fake scanner stands in, so npm test needs no Python.
import assert from "node:assert/strict";
import fs from "node:fs";
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
