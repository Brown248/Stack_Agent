import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { COMMON, FIELDS, FINAL_VERDICTS, KINDS, SEVERITIES, VERDICTS, checkRecords, logRows, main, validateFindings } from "../scripts/review-findings.mjs";
import { main as worktree } from "../scripts/review-worktree.mjs";
import { main as verify } from "../scripts/verify.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { git, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const script = path.join(repoRoot, "scripts", "review-findings.mjs");
const SERVICE = "src/service.js";
const OLD = 'export function create(name) {\n\tif (!name) throw new Error("name required");\n\treturn { name };\n}\n';
const NEW = 'export function create(name) {\n\treturn { name };\n}\n';

// a project with two commits: the first validates names, the second drops the check
function makeRepo() {
	const dir = tempDir("stack-agent-findings-");
	git(dir, "init", "-q");
	write(dir, SERVICE, OLD);
	write(dir, ".stack-agent/rules.md", "# Team rules\n\n- Validate input at the boundary.\n");
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ rules: [{ id: "no-console", pattern: "console\\.log", files: ["src/**"], message: "no console.log" }] }));
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "one");
	write(dir, SERVICE, NEW);
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "two");
	return dir;
}

const repo = makeRepo();
const sha = git(repo, "rev-parse", "HEAD").trim();
const first = git(repo, "rev-parse", "HEAD~1").trim();

const candidate = (over = {}) => ({
	id: "c1",
	commit: sha,
	verdict: "candidate",
	title: "name no longer validated",
	claim: "create accepts an empty name because the check was removed",
	location: { file: SERVICE, line: 1, excerpt: "export function create(name) {" },
	source: "correctness",
	evidence: [{ file: SERVICE, line: 2, excerpt: "return { name };", description: "returns without checking name" }],
	...over,
});
const confirmed = (over = {}) => candidate({ verdict: "confirmed", severity: "blocking", kind: "repeatable", observed: "create('') returns { name: '' }", fix: "restore the name check", found_by: "reviewer", verified_by: "finding-verifier", ...over });
const hardening = (over = {}) => candidate({ verdict: "hardening", control: "the router validates name", suggestion: "also check name in the service", found_by: "reviewer", verified_by: "finding-verifier", ...over });
const needsValidation = (over = {}) => candidate({ verdict: "needs_validation", blockers: ["whether callers already validate"], how_to_check: "grep the callers", found_by: "reviewer", verified_by: "finding-verifier", ...over });
const rejected = (over = {}) => candidate({ verdict: "rejected", reason: "create still returns early when name is empty", found_by: "reviewer", verified_by: "finding-verifier", ...over });
const valid = (records, opts = {}) => validateFindings(records, { root: repo, ...opts });
const has = (errors, re) => assert.ok(errors.some((e) => re.test(e)), `expected ${re} in:\n${errors.join("\n")}`);

test("each verdict with its own fields is valid at its stage", () => {
	assert.deepEqual(valid([candidate()], { stage: "candidates" }), []);
	assert.deepEqual(valid([confirmed({ id: "a" }), needsValidation({ id: "b" }), rejected({ id: "c" }), hardening({ id: "d" })]), []);
});

test("stages accept only their verdicts", () => {
	has(checkRecords([confirmed()], { stage: "candidates" }), /verdict must be candidate at the candidates stage/);
	has(checkRecords([candidate()]), /verdict must be confirmed \| hardening \| needs_validation \| rejected at the final stage/);
	has(checkRecords([candidate({ verdict: "maybe" })], { stage: "candidates" }), /verdict must be candidate/);
});

test("missing, forbidden, and unknown fields are named", () => {
	const { fix, ...noFix } = confirmed();
	has(checkRecords([noFix]), /confirmed needs fix/);
	const { location, ...noLocation } = rejected();
	has(checkRecords([noLocation]), /missing location/);
	has(checkRecords([rejected({ severity: "blocking" })]), /rejected must not have severity/);
	has(checkRecords([needsValidation({ reason: "x" })]), /needs_validation must not have reason/);
	const { control, ...noControl } = hardening();
	has(checkRecords([noControl]), /hardening needs control/);
	has(checkRecords([hardening({ severity: "blocking" })]), /hardening must not have severity/);
	has(checkRecords([rejected({ suggestion: "x" })]), /rejected must not have suggestion/);
	has(checkRecords([hardening({ suggestion: " " })]), /suggestion must be non-empty text/);
	has(checkRecords([candidate({ found_by: "reviewer" })], { stage: "candidates" }), /candidate must not have found_by/);
	has(checkRecords([confirmed({ confidence: "high" })]), /unknown field\(s\): confidence/);
	has(checkRecords([confirmed({ location: { file: SERVICE, line: 1, excerpt: "export", col: 3 } })]), /location has unknown field\(s\): col/);
});

test("enum values, text fields, places, and blockers are checked", () => {
	has(checkRecords([confirmed({ severity: "high" })]), /severity must be blocking \| non-blocking/);
	has(checkRecords([confirmed({ kind: "pattern" })]), /kind must be repeatable \| one-off/);
	has(checkRecords([confirmed({ observed: "  " })]), /observed must be non-empty text/);
	has(checkRecords([needsValidation({ blockers: [] })]), /blockers must list at least one/);
	has(checkRecords([confirmed({ source: "hunch" })]), /source must be/);
	has(checkRecords([confirmed({ evidence: [] })]), /evidence must be a non-empty array/);
	has(checkRecords([confirmed({ evidence: [{ file: SERVICE, line: 2, excerpt: "return { name };" }] })]), /evidence 1\.description is required/);
	has(checkRecords([confirmed({ location: { file: "../outside.js", line: 1, excerpt: "abc" } })]), /file must be a path relative/);
	has(checkRecords([confirmed({ location: { file: SERVICE, line: 0, excerpt: "abc" } })]), /line must be an integer of at least 1/);
	has(checkRecords([confirmed({ location: { file: SERVICE, line: 1, excerpt: "x" } })]), /excerpt must quote at least 3 characters/);
	has(checkRecords({}), /must be a JSON array/);
});

test("duplicate ids are rejected", () => {
	has(checkRecords([confirmed(), rejected()]), /duplicate id/);
});

test("the finder cannot verify its own finding, and only mechanical sources take a script verifier", () => {
	has(checkRecords([confirmed({ verified_by: "reviewer" })]), /verified_by must differ from found_by/);
	has(checkRecords([confirmed({ verified_by: "script:node guard.mjs" })]), /only guard, api-map, and verify-evidence findings can be verified by a script/);
	assert.deepEqual(checkRecords([confirmed({ source: "guard:no-console", verified_by: "script:node .stack-agent/bin/guard.mjs" })]), []);
	assert.deepEqual(checkRecords([rejected({ source: "api-map", verified_by: "script:node .stack-agent/bin/api-map.mjs" })]), []);
});

test("excerpts are grounded in the reviewed code, within 3 lines, whitespace-insensitive", () => {
	assert.deepEqual(valid([confirmed({ location: { file: SERVICE, line: 3, excerpt: "export   function create(name)  {" } })]), []);
	has(valid([confirmed({ location: { file: SERVICE, line: 1, excerpt: "throw new Error" } })]), /does not appear within 3 lines of src\/service\.js:1/);
	has(valid([confirmed({ location: { file: SERVICE, line: 9, excerpt: "return { name };" } })]), /has 4 lines, not 9/);
	has(valid([confirmed({ location: { file: "src/gone.js", line: 1, excerpt: "abc" } })]), /does not exist in the reviewed code/);
	has(valid([confirmed({ evidence: [{ file: SERVICE, line: 2, excerpt: "name required", description: "x" }] })]), /evidence 1: the excerpt does not appear/);
});

test("--ref reads the cited files from a past commit instead of the working tree", () => {
	const old = confirmed({ commit: first, location: { file: SERVICE, line: 2, excerpt: 'throw new Error("name required");' } });
	has(valid([old]), /does not appear/);
	assert.deepEqual(valid([old], { ref: first }), []);
	assert.throws(() => valid([old], { ref: "no-such-ref" }), ConfigError);
	assert.throws(() => valid([old], { root: tempDir(), ref: "HEAD" }), /--ref needs a git repository/);
});

test("--ref works from a project inside a monorepo folder", () => {
	const mono = tempDir("stack-agent-mono-");
	git(mono, "init", "-q");
	write(mono, "apps/api/src/a.js", "const answer = 42;\n");
	git(mono, "add", "-A");
	git(mono, "commit", "-qm", "a");
	write(mono, "apps/api/src/a.js", "const answer = 43;\n");
	const head = git(mono, "rev-parse", "HEAD").trim();
	const r = confirmed({ commit: head, location: { file: "src/a.js", line: 1, excerpt: "const answer = 42;" }, evidence: [{ file: "src/a.js", line: 1, excerpt: "answer = 42", description: "x" }] });
	assert.deepEqual(validateFindings([r], { root: path.join(mono, "apps/api"), ref: "HEAD" }), []);
	has(validateFindings([r], { root: path.join(mono, "apps/api") }), /does not appear/);
});

test("guard rule ids and rules.md lines must exist", () => {
	assert.deepEqual(valid([confirmed({ source: "guard:no-console", verified_by: "script:guard" })]), []);
	has(valid([confirmed({ source: "guard:no-eval", verified_by: "script:guard" })]), /guard:no-eval is not a rule in \.stack-agent\/guard\.config\.json/);
	assert.deepEqual(valid([confirmed({ source: "rules.md:3" })]), []);
	has(valid([confirmed({ source: "rules.md:40" })]), /past the end of \.stack-agent\/rules\.md/);
	has(validateFindings([confirmed({ source: "rules.md:1", location: { file: "a.js", line: 1, excerpt: "abc" }, evidence: [{ file: "a.js", line: 1, excerpt: "abc", description: "x" }] })], { root: tempDir() }), /cites \.stack-agent\/rules\.md, which does not exist/);
});

test("size limits: too many records and too many errors", () => {
	has(checkRecords(Array.from({ length: 1001 }, (_, i) => confirmed({ id: `x${i}` }))), /too many findings/);
	const file = path.join(tempDir(), "many.json");
	fs.writeFileSync(file, JSON.stringify(Array.from({ length: 200 }, (_, i) => confirmed({ id: `x${i}`, severity: "high" }))));
	const r = main(["validate", file, "--root", repo, "--json"]);
	assert.equal(r.code, 1);
	const out = JSON.parse(r.text);
	assert.equal(out.errors.length, 101);
	assert.match(out.errors.at(-1), /and 100 more/);
});

test("CLI: exit codes, stages, and unreadable input", () => {
	const dir = tempDir();
	const good = path.join(dir, "good.json");
	fs.writeFileSync(good, JSON.stringify([candidate()]));
	let r = runNode(script, ["validate", good, "--stage", "candidates", "--root", repo]);
	assert.equal(r.code, 0, r.stderr);
	assert.match(r.stdout, /review-findings: ok \(1 finding\(s\), candidates\)/);
	r = runNode(script, ["validate", good, "--root", repo]);
	assert.equal(r.code, 1);
	assert.match(r.stderr, /INVALID/);
	const bad = path.join(dir, "bad.json");
	fs.writeFileSync(bad, "[not json");
	assert.equal(runNode(script, ["validate", bad]).code, 2);
	assert.equal(runNode(script, ["validate", path.join(dir, "missing.json")]).code, 2);
	assert.equal(runNode(script, ["validate", good, "--stage", "draft"]).code, 2);
	assert.equal(runNode(script, ["frobnicate", good]).code, 2);
});

test("rows prints one log row per final finding with its action", () => {
	const records = [
		confirmed({ id: "a" }),
		confirmed({ id: "b", kind: "one-off", severity: "non-blocking", fix: "rename | the var" }),
		needsValidation({ id: "c" }),
		rejected({ id: "d" }),
		hardening({ id: "e" }),
	];
	assert.deepEqual(logRows(records, "2026-10-21"), [
		`| 2026-10-21 | ${sha.slice(0, 12)} | name no longer validated (src/service.js:1) | repeatable (blocking): to /stack-agent:correct |`,
		`| 2026-10-21 | ${sha.slice(0, 12)} | name no longer validated (src/service.js:1) | one-off (non-blocking): rename \\| the var |`,
		`| 2026-10-21 | ${sha.slice(0, 12)} | name no longer validated (src/service.js:1) | needs validation: whether callers already validate |`,
		`| 2026-10-21 | ${sha.slice(0, 12)} | name no longer validated (src/service.js:1) | dismissed: create still returns early when name is empty |`,
		`| 2026-10-21 | ${sha.slice(0, 12)} | name no longer validated (src/service.js:1) | hardening (already stopped by the router validates name): also check name in the service |`,
	]);
	const file = path.join(tempDir(), "f.json");
	fs.writeFileSync(file, JSON.stringify(records));
	assert.equal(main(["rows", file, "--date", "2026-10-21"]).text.split("\n").length, 5);
	assert.throws(() => main(["rows", file]), /--date YYYY-MM-DD/);
	fs.writeFileSync(file, JSON.stringify([candidate()]));
	assert.throws(() => main(["rows", file, "--date", "2026-10-21"]), /not a valid final findings file/);
});

test("review-worktree add checks out the old commit and remove cleans it up", () => {
	const added = JSON.parse(worktree(["add", first, "--root", repo, "--json"]).text);
	try {
		assert.equal(added.rev, first);
		assert.equal(fs.readFileSync(path.join(added.root, SERVICE), "utf8").replace(/\r\n/g, "\n"), OLD);
		assert.equal(fs.readFileSync(path.join(repo, SERVICE), "utf8"), NEW);
		assert.match(path.basename(added.tmp), /^stack-agent-review-/);
		const grounded = confirmed({ commit: first, location: { file: SERVICE, line: 2, excerpt: "name required" } });
		assert.deepEqual(validateFindings([grounded], { root: added.root }), []);
	} finally {
		worktree(["remove", added.tmp, "--root", repo]);
	}
	assert.equal(fs.existsSync(added.tmp), false);
	assert.doesNotMatch(git(repo, "worktree", "list"), /stack-agent-review-/);
});

test("review-worktree keeps the project's subfolder in a monorepo and links node_modules", () => {
	const mono = tempDir("stack-agent-mono-wt-");
	git(mono, "init", "-q");
	write(mono, "apps/api/src/a.js", "const answer = 42;\n");
	git(mono, "add", "-A");
	git(mono, "commit", "-qm", "a");
	write(mono, "apps/api/node_modules/dep/index.js", "module.exports = 1;\n");
	const api = path.join(mono, "apps/api");
	const added = JSON.parse(worktree(["add", "HEAD", "--root", api, "--json"]).text);
	try {
		assert.equal(path.basename(added.root), "api");
		assert.ok(fs.existsSync(path.join(added.root, "src/a.js")));
		assert.ok(fs.existsSync(path.join(added.root, "node_modules/dep/index.js")));
	} finally {
		worktree(["remove", added.tmp, "--root", api]);
	}
	assert.equal(fs.existsSync(added.tmp), false);
	assert.ok(fs.existsSync(path.join(api, "node_modules/dep/index.js")), "the linked folder itself is left alone");
});

test("review-worktree refuses bad input", () => {
	assert.throws(() => worktree(["add", "no-such-ref", "--root", repo]), /could not check out no-such-ref/);
	assert.throws(() => worktree(["add", "HEAD", "--root", tempDir()]), /not a git repository/);
	assert.throws(() => worktree(["remove", tempDir(), "--root", repo]), /named stack-agent-review-/);
	assert.throws(() => worktree(["add"]), /needs a revision/);
	assert.throws(() => worktree(["prune"]), /unknown command/);
});

test("verify --evidence-status: missing, fresh, stale, partial, failed", async () => {
	const dir = tempDir("stack-agent-evstatus-");
	write(dir, "ok.cjs", "console.log('ok');\n");
	write(dir, ".gitignore", ".stack-agent/evidence/\n");
	write(dir, ".stack-agent/verify.json", JSON.stringify({ against: false, checks: [{ name: "a", command: "node ok.cjs", expectOutputIncludes: "ok" }, { name: "b", command: "node ok.cjs" }] }));
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "init");
	const status = async () => JSON.parse((await verify(["--root", dir, "--evidence-status", "--json"])).text);
	let s = await status();
	assert.deepEqual([s.ok, s.why], [false, "no evidence yet"]);
	assert.equal((await verify(["--root", dir])).code, 0);
	s = await status();
	assert.deepEqual([s.ok, s.full, s.passed, s.matches, s.why], [true, true, true, true, "matches the code"]);
	const plain = await verify(["--root", dir, "--evidence-status"]);
	assert.equal(plain.code, 0);
	assert.match(plain.text, /^evidence: ok, matches the code/);
	write(dir, "ok.cjs", "console.log('ok'); // changed\n");
	s = await status();
	assert.deepEqual([s.ok, s.why], [false, "the code changed after the latest run"]);
	assert.equal((await verify(["--root", dir, "--evidence-status"])).code, 1);
	assert.equal((await verify(["--root", dir, "--check", "a"])).code, 0);
	s = await status();
	assert.deepEqual([s.ok, s.why], [false, "the latest run was partial"]);
	write(dir, "ok.cjs", "process.exit(1);\n");
	assert.equal((await verify(["--root", dir])).code, 1);
	s = await status();
	assert.deepEqual([s.ok, s.why], [false, "the latest run failed"]);
});

// The agents and the skill are prompts; the validator is code. These keep the two from drifting apart.
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");

test("the reviewer and verifier prompts name every field and value the validator expects", () => {
	const reviewer = read("agents/reviewer.md");
	const verifier = read("agents/finding-verifier.md");
	for (const text of [reviewer, verifier]) assert.ok(text.includes("`spec`") && text.includes("commit-message"), "both prompts describe spec findings");
	const skill = read("skills/sample-review/SKILL.md");
	for (const k of [...COMMON, ...FIELDS.candidate]) assert.ok(reviewer.includes(`\`${k}\``), `agents/reviewer.md does not mention \`${k}\``);
	assert.ok(reviewer.includes("`candidate`"));
	for (const src of ["guard:<rule-id>", "api-map", "verify-evidence", "rules.md:<line>", "correctness", "`spec`"]) assert.ok(reviewer.includes(src), `reviewer.md does not mention ${src}`);
	const verifierFields = [...COMMON, ...new Set(FINAL_VERDICTS.flatMap((v) => FIELDS[v]))].filter((k) => !["found_by", "verified_by"].includes(k));
	for (const k of verifierFields) assert.ok(verifier.includes(`\`${k}\``), `agents/finding-verifier.md does not mention \`${k}\``);
	for (const v of [...VERDICTS.filter((v) => v !== "candidate"), ...SEVERITIES, ...KINDS]) assert.ok(verifier.includes(`\`${v}\``), `finding-verifier.md does not mention \`${v}\``);
	for (const k of ["found_by", "verified_by", "candidates", "final"]) assert.ok(skill.includes(k), `sample-review SKILL.md does not mention ${k}`);
	for (const v of FINAL_VERDICTS) assert.ok(skill.includes(`\`${v}\``), `sample-review SKILL.md does not say what to do with \`${v}\``);
});

test("every flag the skills and agents pass to a script is in that script's usage", () => {
	const scripts = ["review-findings", "review-worktree", "sample-commits", "verify"];
	const usage = Object.fromEntries(scripts.map((s) => [s, runNode(path.join(repoRoot, "scripts", `${s}.mjs`), ["--help"]).stdout]));
	const docs = [
		...fs.readdirSync(path.join(repoRoot, "skills")).map((d) => `skills/${d}/SKILL.md`),
		...fs.readdirSync(path.join(repoRoot, "agents")).map((f) => `agents/${f}`),
	].filter((rel) => fs.existsSync(path.join(repoRoot, rel)));
	let seen = 0;
	for (const rel of docs)
		for (const line of read(rel).split("\n"))
			for (const s of scripts) {
				let at = line.indexOf(`${s}.mjs`);
				while (at !== -1) {
					const rest = line.slice(at + s.length + 4);
					const span = rest.includes("`") ? rest.slice(0, rest.indexOf("`")) : rest;
					for (const flag of span.match(/--[a-z][a-z-]*/g) ?? []) {
						seen++;
						assert.ok(usage[s].includes(flag), `${rel} passes ${flag} to ${s}.mjs, which its usage does not list`);
					}
					at = line.indexOf(`${s}.mjs`, at + 1);
				}
			}
	assert.ok(seen >= 6, `expected to find script flags in the docs, found ${seen}`);
});

test("a guard id the guard reports on its own (invalid-allow) is accepted", () => {
	assert.deepEqual(valid([confirmed({ source: "guard:invalid-allow", verified_by: "script:node .stack-agent/bin/guard.mjs" })]), []);
});

test("--candidates: every candidate needs exactly one final record, and no extras", () => {
	const cands = [candidate({ id: "a" }), candidate({ id: "b" })];
	assert.deepEqual(valid([confirmed({ id: "a" }), rejected({ id: "b" })], { candidates: cands }), []);
	has(valid([confirmed({ id: "a" })], { candidates: cands }), /candidate b has no final record/);
	has(valid([confirmed({ id: "a" }), rejected({ id: "b" }), rejected({ id: "z" })], { candidates: cands }), /finding z is not one of the candidates/);
	const dir = tempDir();
	fs.writeFileSync(path.join(dir, "c.json"), JSON.stringify(cands));
	fs.writeFileSync(path.join(dir, "f.json"), JSON.stringify([confirmed({ id: "a" })]));
	const r = main(["validate", path.join(dir, "f.json"), "--root", repo, "--candidates", path.join(dir, "c.json")]);
	assert.equal(r.code, 1);
	assert.match(r.text, /candidate b has no final record/);
});

test("review-worktree remove refuses a prefixed folder that add did not make", () => {
	const victim = path.join(tempDir(), "stack-agent-review-victim");
	write(victim, "file.txt", "important\n");
	assert.throws(() => worktree(["remove", victim, "--root", repo]), /with no-hooks and wt inside/);
	assert.equal(fs.readFileSync(path.join(victim, "file.txt"), "utf8"), "important\n");
});

test("createWorktree removes its checkout when setting it up fails part way", async () => {
	const { createWorktree } = await import("../scripts/verify.mjs");
	const dir = tempDir("stack-agent-wtfail-");
	git(dir, "init", "-q");
	write(dir, "dep", "a file in the commit\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "a");
	fs.rmSync(path.join(dir, "dep"));
	write(dir, "dep/sub/x.js", "1\n");
	const base = tempDir("stack-agent-wtbase-");
	const made = createWorktree(dir, "HEAD", { prefix: "stack-agent-review-", tmpDir: base, link: ["dep/sub"] });
	assert.match(made.error, /could not set up a checkout of HEAD/);
	assert.deepEqual(fs.readdirSync(base), []);
	assert.doesNotMatch(git(dir, "worktree", "list"), /stack-agent-review-/);
	assert.ok(fs.existsSync(path.join(dir, "dep/sub/x.js")));
});

test("verify --evidence-status names a skip recorded for the current code", async () => {
	const dir = tempDir("stack-agent-evskip-");
	write(dir, "ok.cjs", "console.log('ok');\n");
	write(dir, ".stack-agent/verify.json", JSON.stringify({ against: false, checks: [{ name: "a", command: "node ok.cjs" }] }));
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "init");
	await verify(["--root", dir, "--skip", "no database in this sandbox"]);
	const s = JSON.parse((await verify(["--root", dir, "--evidence-status", "--json"])).text);
	assert.equal(s.ok, false);
	assert.equal(s.why, "verification was skipped for this code: no database in this sandbox");
});

test("a finding about a commit must cite a file that commit changed", () => {
	const base = tempDir("stack-agent-changed-");
	git(base, "init", "-q");
	write(base, "apps/api/src/a.js", "export const a = 1;\n");
	write(base, "apps/api/src/b.js", "export const b = 1;\n");
	git(base, "add", "-A");
	git(base, "commit", "-qm", "one");
	write(base, "apps/api/src/b.js", "export const b = 2;\n");
	git(base, "add", "-A");
	git(base, "commit", "-qm", "two");
	const api = path.join(base, "apps/api");
	const one = git(base, "rev-parse", "HEAD~1").trim();
	const two = git(base, "rev-parse", "HEAD").trim();
	const at = (file, excerpt) => ({ file, line: 1, excerpt });
	const ev = (file, excerpt) => [{ ...at(file, excerpt), description: "x" }];
	// a problem already in a.js, reported against commit two, which only changed b.js
	const stale = confirmed({ commit: two, location: at("src/a.js", "export const a = 1;"), evidence: ev("src/a.js", "export const a = 1;") });
	has(validateFindings([stale], { root: api }), /neither the location nor any evidence cites a file commit [0-9a-f]{12} changed/);
	// the same finding against commit one (root commit, which added a.js) is fine
	assert.deepEqual(validateFindings([{ ...stale, commit: one }], { root: api }), []);
	// a finding located elsewhere is fine when one evidence entry cites the changed file
	const caller = confirmed({ commit: two, location: at("src/a.js", "export const a = 1;"), evidence: ev("src/b.js", "export const b = 2;") });
	assert.deepEqual(validateFindings([caller], { root: api }), []);
	// worktree findings and folders outside git are not checked; an unknown commit is
	assert.deepEqual(validateFindings([{ ...stale, commit: "worktree" }], { root: api }), []);
	has(validateFindings([{ ...stale, commit: "0123456789abcdef0123456789abcdef01234567" }], { root: api }), /is not in this repository/);
	// "./src/b.js" names the same file as "src/b.js"
	assert.deepEqual(validateFindings([{ ...caller, evidence: ev("./src/b.js", "export const b = 2;") }], { root: api }), []);
	// outside git the check is off and nothing else complains
	const plain = tempDir("stack-agent-nogit-");
	write(plain, "src/a.js", "export const a = 1;\n");
	assert.deepEqual(validateFindings([stale], { root: plain }), []);
});

test("changed files: unicode and spaces in paths, merge commits, and deleted files", () => {
	const dir = tempDir("stack-agent-changed2-");
	git(dir, "init", "-q");
	git(dir, "checkout", "-q", "-b", "main");
	write(dir, "src/util.js", "export const util = 1;\n");
	write(dir, "src/a.js", 'import { util } from "./util.js";\n');
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	const at = (file, line, excerpt) => ({ file, line, excerpt });
	const ev = (file, line, excerpt) => [{ ...at(file, line, excerpt), description: "x" }];
	// a non-ASCII file name with a space, which git quotes unless -z is used
	write(dir, "src/my file é.js", "export const e = 1;\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "unicode");
	const uni = confirmed({ commit: git(dir, "rev-parse", "HEAD").trim(), location: at("src/my file é.js", 1, "export const e = 1;"), evidence: ev("src/my file é.js", 1, "export const e = 1;") });
	assert.deepEqual(validateFindings([uni], { root: dir }), []);
	// a merge: what the merged branch brought in counts, what main changed on its own side does not
	git(dir, "checkout", "-q", "-b", "side");
	write(dir, "src/side.js", "export const side = 1;\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "side");
	git(dir, "checkout", "-q", "main");
	write(dir, "src/main.js", "export const main = 1;\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "main side");
	git(dir, "merge", "-q", "--no-ff", "-m", "merge side", "side");
	const merge = git(dir, "rev-parse", "HEAD").trim();
	assert.deepEqual(validateFindings([confirmed({ commit: merge, location: at("src/side.js", 1, "export const side = 1;"), evidence: ev("src/side.js", 1, "export const side = 1;") })], { root: dir }), []);
	has(validateFindings([confirmed({ commit: merge, location: at("src/main.js", 1, "export const main = 1;"), evidence: ev("src/main.js", 1, "export const main = 1;") })], { root: dir }), /cites a file commit/);
	// deleting util.js breaks a.js: cite the deleted file as it was before the commit
	fs.rmSync(path.join(dir, "src/util.js"));
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "drop util");
	const drop = git(dir, "rev-parse", "HEAD").trim();
	const broken = confirmed({ commit: drop, location: at("src/a.js", 1, 'import { util } from "./util.js";'), evidence: ev("src/util.js", 1, "export const util = 1;") });
	assert.deepEqual(validateFindings([broken], { root: dir }), []);
	has(validateFindings([{ ...broken, evidence: ev("src/util.js", 1, "export const other = 2;") }], { root: dir }), /excerpt does not appear/);
	has(validateFindings([{ ...broken, commit: "worktree" }], { root: dir }), /src\/util\.js does not exist in the reviewed code/);
});

test("agents run git with -C on the review root and never cd first, and stop on an unreadable diff", () => {
	for (const rel of ["agents/reviewer.md", "agents/finding-verifier.md"]) {
		const text = read(rel);
		const gitCalls = [...text.matchAll(/`(git [^`]*)`/g)].map((m) => m[1]).filter((c) => c !== "git -C");
		assert.ok(gitCalls.length > 0, `${rel} names no git command`);
		for (const call of gitCalls) assert.match(call, /^git -C "<review root>" /, `${rel}: \`${call}\` should start with git -C "<review root>"`);
		assert.doesNotMatch(text, /`cd /, `${rel} tells the agent to cd`);
		assert.match(text, /diff cannot be read/, `${rel} does not say what to do when the diff cannot be read`);
		for (const m of text.matchAll(/`node ([^`]*\.stack-agent\/bin\/[^`]*)`/g)) assert.match(m[1], /--root "<review root>"/, `${rel}: \`node ${m[1]}\` should pass --root`);
	}
});

test("spec findings quote what was asked, from the commit message or a spec file", () => {
	const dir = tempDir("stack-agent-spec-");
	git(dir, "init", "-q");
	write(dir, "src/items.js", "export function create(name) {\n\treturn { name };\n}\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "items: add create\n\nPOST /items must return 400 when name is empty.");
	const head = git(dir, "rev-parse", "HEAD").trim();
	const at = { file: "src/items.js", line: 2, excerpt: "return { name };" };
	const spec = (over = {}) =>
		confirmed({ commit: head, source: "spec", spec: { from: "commit-message", quote: "must return 400 when name is empty" }, location: at, evidence: [{ ...at, description: "no check for an empty name" }], ...over });
	assert.deepEqual(validateFindings([spec()], { root: dir }), []);
	// whitespace in the quote does not matter, a quote the message does not contain does
	assert.deepEqual(validateFindings([spec({ spec: { from: "commit-message", quote: "must  return 400\nwhen name is empty" } })], { root: dir }), []);
	has(validateFindings([spec({ spec: { from: "commit-message", quote: "must return 404" } })], { root: dir }), /spec\.quote does not appear in the message of commit/);
	// a spec file relative to the root
	write(dir, ".stack-agent/evidence/review/x/spec.md", "Reject empty names with a 400.\n");
	assert.deepEqual(validateFindings([spec({ spec: { from: ".stack-agent/evidence/review/x/spec.md", quote: "Reject empty names" } })], { root: dir }), []);
	has(validateFindings([spec({ spec: { from: "missing.md", quote: "Reject empty names" } })], { root: dir }), /cannot be read/);
	// shape
	const { spec: _, ...noSpec } = spec();
	has(checkRecords([noSpec]), /a spec finding needs spec/);
	has(checkRecords([confirmed({ spec: { from: "commit-message", quote: "abc" } })]), /only a spec finding has spec/);
	has(checkRecords([spec({ spec: { from: "../x.md", quote: "abc" } })]), /spec\.from must be commit-message or a file/);
	has(checkRecords([spec({ spec: { from: "commit-message", quote: "x" } })]), /spec\.quote must quote at least 3 characters/);
	has(checkRecords([spec({ spec: { from: "commit-message", quote: "abc", page: 1 } })]), /spec has unknown field\(s\): page/);
	has(checkRecords([spec({ commit: "worktree" })]), /an uncommitted change has no commit message/);
	// candidates carry spec too, and a spec finding needs an agent verifier
	assert.deepEqual(checkRecords([candidate({ source: "spec", spec: { from: "commit-message", quote: "abc" } })], { stage: "candidates" }), []);
	has(checkRecords([spec({ verified_by: "script:node x.mjs" })]), /only guard, api-map, and verify-evidence findings can be verified by a script/);
});
