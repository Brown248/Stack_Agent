import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { isGuardFile, main, parseLogRow, pickIndexes } from "../scripts/sample-commits.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { git, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const script = path.join(repoRoot, "scripts", "sample-commits.mjs");
const sample = (dir, ...args) => main(["--root", dir, ...args]);
const json = (dir, ...args) => JSON.parse(sample(dir, ...args, "--json").text);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

function commit(dir, rel, text, message, date) {
	write(dir, rel, text);
	git(dir, "add", "-A");
	if (date) process.env.GIT_COMMITTER_DATE = date;
	try {
		git(dir, "commit", "-qm", message, ...(date ? ["--date", date] : []));
	} finally {
		delete process.env.GIT_COMMITTER_DATE;
	}
}

// Two old commits (10 days ago), then eight recent ones; recent #4 touches the guard baseline, #6 the guard config.
function makeRepo() {
	const dir = tempDir("stack-agent-sample-");
	git(dir, "init", "-q");
	commit(dir, "src/old1.js", "1\n", "old one", daysAgo(10));
	commit(dir, "src/old2.js", "2\n", "old two", daysAgo(10));
	git(dir, "tag", "base");
	for (let i = 1; i <= 8; i++) {
		if (i === 4) commit(dir, ".stack-agent/guard-baseline.json", '{"version":1,"counts":{}}\n', "recent 4 baseline");
		else if (i === 6) commit(dir, ".stack-agent/guard.config.json", '{"rules":[]}\n', "recent 6 config");
		else commit(dir, `src/r${i}.js`, `${i}\n`, `recent ${i}`);
	}
	return dir;
}

const repo = makeRepo();

test("default samples 5 commits from the last 24 hours, newest first", () => {
	const r = json(repo);
	assert.equal(r.total, 8);
	assert.equal(r.sampled.length, 5);
	assert.equal(r.since, "24 hours ago");
	assert.ok(r.sampled.every((c) => c.subject.startsWith("recent")));
	const order = r.sampled.map((c) => Number(c.subject.split(" ")[1]));
	assert.deepEqual(order, [...order].sort((a, b) => b - a));
	for (const c of r.sampled) {
		assert.match(c.sha, /^[0-9a-f]{40}$/);
		assert.equal(c.author, "test <test@example.com>");
		assert.equal(c.files.length, 1);
	}
});

test("--since widens the window to older commits", () => {
	assert.equal(json(repo, "--since", "30 days ago", "--count", "50").total, 10);
	assert.equal(json(repo, "--since", "3 days ago", "--count", "50").total, 8);
});

test("--range samples only that range and drops the default --since", () => {
	const r = json(repo, "--range", "base~1..base", "--count", "50");
	assert.equal(r.since, null);
	assert.deepEqual(r.sampled.map((c) => c.subject), ["old two"]);
	assert.equal(json(repo, "--range", "base..HEAD", "--count", "50").total, 8);
});

test("--count caps the pick and returns everything when the range is smaller", () => {
	assert.equal(json(repo, "--count", "2").sampled.length, 2);
	assert.equal(json(repo, "--count", "100").sampled.length, 8);
});

test("--seed makes the pick reproducible and different seeds differ", () => {
	const shas = (seed) => json(repo, "--seed", seed, "--count", "3").sampled.map((c) => c.sha);
	assert.deepEqual(shas("abc"), shas("abc"));
	const picks = new Set(["a", "b", "c", "d", "e", "f"].map((s) => shas(s).join()));
	assert.ok(picks.size > 1, "six seeds all picked the same commits");
	assert.deepEqual(pickIndexes(10, 4, "x"), pickIndexes(10, 4, "x"));
	assert.equal(new Set(pickIndexes(10, 4, "x")).size, 4);
	assert.deepEqual(pickIndexes(3, 5, "x"), [0, 1, 2]);
});

test("without --seed a seed is chosen and printed so the pick can be repeated", () => {
	const r = sample(repo, "--count", "3");
	const seed = /--seed (\S+) and the review log as it is now for the same pick/.exec(r.text)?.[1];
	assert.ok(seed, r.text);
	const again = sample(repo, "--count", "3", "--seed", seed);
	const shas = (text) => [...text.matchAll(/^([0-9a-f]{12}) /gm)].map((m) => m[1]);
	assert.deepEqual(shas(again.text), shas(r.text));
});

test("commits that change the guard baseline or config are flagged loudly", () => {
	const r = json(repo, "--count", "50");
	const flagged = Object.fromEntries(r.sampled.map((c) => [c.subject, c.guardFiles]));
	assert.deepEqual(flagged["recent 4 baseline"], [".stack-agent/guard-baseline.json"]);
	assert.deepEqual(flagged["recent 6 config"], [".stack-agent/guard.config.json"]);
	assert.deepEqual(flagged["recent 1"], []);
	assert.equal(r.flagged, 2);
	const text = sample(repo, "--count", "50").text;
	assert.match(text, /!!! GUARD FILE CHANGED: \.stack-agent\/guard-baseline\.json/);
	assert.match(text, /!!! GUARD FILE CHANGED: \.stack-agent\/guard\.config\.json/);
	assert.match(text, /!!! 2 sampled commit\(s\) changed guard config or baseline/);
	assert.ok(isGuardFile("config/guard.config.json"));
	assert.ok(!isGuardFile("src/guard-baseline.json.bak"));
});

test("a root commit lists its files and an empty window exits 0", () => {
	const first = json(repo, "--range", "base~1", "--count", "50").sampled.find((c) => c.subject === "old one");
	assert.deepEqual(first.files, ["src/old1.js"]);
	const none = sample(repo, "--since", "2099-01-01");
	assert.equal(none.code, 0);
	assert.match(none.text, /0 of 0 commit\(s\)/);
});

test("a repo with no commits yet samples nothing", () => {
	const dir = tempDir("stack-agent-sample-");
	git(dir, "init", "-q");
	assert.equal(json(dir).total, 0);
});

test("bad arguments throw ConfigError", () => {
	for (const args of [["--count", "0"], ["--count", "2.5"], ["--count", "x"], ["--range", "nope..HEAD"], ["--range", "--all"], ["--since", " "], ["--bogus"], ["stray"]])
		assert.throws(() => sample(repo, ...args), ConfigError, args.join(" "));
});

test("CLI exits 2 on bad args and outside a git repo, 0 on success", () => {
	const notRepo = tempDir("stack-agent-sample-");
	const outside = runNode(script, ["--root", notRepo]);
	assert.equal(outside.code, 2);
	assert.match(outside.stderr, /not a git repository/);
	assert.equal(runNode(script, ["--root", path.join(notRepo, "missing")]).code, 2);
	const bad = runNode(script, ["--root", repo, "--count", "-1"]);
	assert.equal(bad.code, 2);
	assert.match(bad.stderr, /usage:/);
	const ok = runNode(script, ["--root", repo, "--count", "1", "--seed", "s"]);
	assert.equal(ok.code, 0, ok.stderr);
	assert.match(ok.stdout, /1 of 8 commit\(s\)/);
});

// c1 and c2 touch a.js, c3 touches b.js, c4 touches c.js; the log says c1 was reviewed
function ledgerRepo() {
	const dir = tempDir("stack-agent-ledger-");
	git(dir, "init", "-q");
	commit(dir, "src/a.js", "1\n", "c1");
	commit(dir, "src/a.js", "2\n", "c2");
	commit(dir, "src/b.js", "1\n", "c3");
	commit(dir, "src/c.js", "1\n", "c4");
	const sha = (msg) => git(dir, "log", "--format=%H", `--grep=^${msg}$`).trim();
	return { dir, sha };
}
const logWith = (dir, rows) => write(dir, ".stack-agent/review-log.md", ["# Sampling review log", "", "| Date | Commit | Finding | Action |", "|------|--------|---------|--------|", ...rows, ""].join("\n"));
const subjects = (r) => r.sampled.map((c) => c.subject).sort();

test("the review log is a ledger: reviewed commits are skipped and unreviewed files are picked first", () => {
	const { dir, sha } = ledgerRepo();
	logWith(dir, [`| 2026-10-21 | ${sha("c1").slice(0, 12)} | a finding (src/a.js:1) | one-off (non-blocking): fix it |`, "| 2026-10-21 | - | sampled 1 of 1, seed x | node sample-commits.mjs |"]);
	for (const seed of ["a", "b", "c", "d", "e"]) {
		const two = json(dir, "--range", "HEAD", "--count", "2", "--seed", seed);
		assert.deepEqual(subjects(two), ["c3", "c4"], `seed ${seed}`);
		assert.deepEqual(two.ledger.alreadyReviewed, 1);
		assert.equal(two.ledger.touchingUnreviewedFiles, 2);
		assert.deepEqual(two.sampled.map((c) => c.unreviewedFiles), [["src/c.js"], ["src/b.js"]]);
	}
	// c2 only touches a file the review of c1 already covered, so it fills the last place
	assert.deepEqual(subjects(json(dir, "--range", "HEAD", "--count", "3", "--seed", "a")), ["c2", "c3", "c4"]);
	const text = sample(dir, "--range", "HEAD", "--count", "2", "--seed", "a").text;
	assert.match(text, /ledger \.stack-agent[\/]review-log\.md: 1 already reviewed \(skipped\), 2 touch files no review has covered \(picked first\)/);
	assert.match(text, /not covered by any review yet \(1\): src\/b\.js/);
});

test("ledger: not-reviewed rows do not count, unknown shas are noted, and --no-ledger samples everything", () => {
	const { dir, sha } = ledgerRepo();
	logWith(dir, [`| 2026-10-21 | ${sha("c1").slice(0, 12)} | - | not reviewed: diff could not be read |`, "| 2026-10-21 | 0123456789ab | a finding (x.js:1) | dismissed: no |"]);
	const r = json(dir, "--range", "HEAD", "--count", "10", "--seed", "a");
	assert.equal(r.ledger.alreadyReviewed, 0);
	assert.deepEqual(r.ledger.unknownShas, ["0123456789ab"]);
	assert.deepEqual(subjects(r), ["c1", "c2", "c3", "c4"]);
	logWith(dir, [`| 2026-10-21 | ${sha("c1")} | f (src/a.js:1) | dismissed: no |`]);
	assert.deepEqual(subjects(json(dir, "--range", "HEAD", "--count", "10", "--seed", "a", "--no-ledger")), ["c1", "c2", "c3", "c4"]);
	assert.equal(json(dir, "--range", "HEAD", "--seed", "a", "--no-ledger").ledger, null);
	assert.throws(() => sample(dir, "--log", "x.md", "--no-ledger"), /--log or --no-ledger, not both/);
	// --log points at another file; a missing log means nothing was reviewed yet
	assert.equal(json(dir, "--range", "HEAD", "--seed", "a", "--log", "nowhere.md").ledger.alreadyReviewed, 0);
});

test("ledger: when every commit in the window is reviewed, nothing is picked and the output says why", () => {
	const { dir, sha } = ledgerRepo();
	logWith(dir, ["c1", "c2", "c3", "c4"].map((m) => `| 2026-10-21 | ${sha(m).slice(0, 12)} | no findings | no findings |`));
	const r = json(dir, "--range", "HEAD", "--seed", "a");
	assert.equal(r.sampled.length, 0);
	assert.match(sample(dir, "--range", "HEAD", "--seed", "a").text, /every commit in the window is already in the review log/);
});

test("ledger: lenient rows, escaped pipes, CRLF, and reviewer-output-unusable rows", () => {
	const { dir, sha } = ledgerRepo();
	const rows = [
		`| 2026-10-21 | ${sha("c1").slice(0, 12)} | a \\| b (src/a.js:1) | dismissed: x \\| y |`,
		`| 2026-10-21 | ${sha("c4").slice(0, 12)} | a | b, written without escaping | not reviewed: diff could not be read |`,
		`| 2026-10-21 | ${sha("c3").slice(0, 12)} | no findings | no findings`,
		`| 2026-10-21 | ${sha("c4").slice(0, 12)} | not reviewed: reviewer output unusable | - |`,
		`| 2026-10-21 | ${sha("c2").slice(0, 12)} | reviewer output unusable | x |`,
	];
	write(dir, ".stack-agent/review-log.md", ["| Date | Commit | Finding | Action |", "|---|---|---|---|", ...rows, ""].join("\r\n"));
	const r = json(dir, "--range", "HEAD", "--count", "10", "--seed", "a");
	// c1 and c3 count (escaped pipe, missing closing pipe); c4 and c2 do not (not reviewed in either column)
	assert.equal(r.ledger.alreadyReviewed, 2);
	assert.deepEqual(subjects(r), ["c2", "c4"]);
	assert.deepEqual(r.ledger.unknownShas, []);
	assert.deepEqual(parseLogRow("| d | abc1234 | a \\| b | dismissed: x \\| y |"), { commit: "abc1234", finding: "a \\| b", action: "dismissed: x \\| y" });
	assert.deepEqual(parseLogRow("| d | abc1234 | no findings | no findings"), { commit: "abc1234", finding: "no findings", action: "no findings" });
	assert.equal(parseLogRow("not a row"), null);
});

test("ledger: the commit that only appends to the review log is not sampled, and the pick follows the seed", () => {
	const { dir, sha } = ledgerRepo();
	commit(dir, "src/d.js", "1\n", "c5");
	commit(dir, "src/e.js", "1\n", "c6");
	logWith(dir, [`| 2026-10-21 | ${sha("c1").slice(0, 12)} | f (src/a.js:1) | dismissed: no |`]);
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "log review");
	const r = json(dir, "--range", "HEAD", "--count", "10", "--seed", "a");
	assert.equal(r.ledger.logOnly, 1);
	assert.ok(!subjects(r).includes("log review"));
	// four commits touch unreviewed files (c3..c6); one place goes to one of them, chosen by the seed
	const picks = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => json(dir, "--range", "HEAD", "--count", "1", "--seed", s).sampled[0].subject));
	assert.ok(picks.size > 1, `the seed should change the pick: ${[...picks]}`);
	for (const p of picks) assert.ok(["c3", "c4", "c5", "c6"].includes(p), p);
	assert.deepEqual(json(dir, "--range", "HEAD", "--count", "1", "--seed", "a").sampled[0].sha, json(dir, "--range", "HEAD", "--count", "1", "--seed", "a").sampled[0].sha);
});
