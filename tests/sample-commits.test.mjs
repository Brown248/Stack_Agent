import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { isGuardFile, main, pickIndexes } from "../scripts/sample-commits.mjs";
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
	const seed = /--seed (\S+) for the same pick/.exec(r.text)?.[1];
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
