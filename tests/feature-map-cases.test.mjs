// Cases per feature, the repair help (--suggest), and the edge cases found while reading the parser. The older tests in
// feature-map.test.mjs and maps-coverage.test.mjs keep covering the main table; nothing here changes how a map without
// a cases section reads or prints.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main, parseCases, parseFeatureMap } from "../scripts/feature-map.mjs";
import { tempDir, write } from "./helpers.mjs";

const HEAD = "| Feature | Where | How a user reaches it | Check |\n| --- | --- | --- | --- |\n";
const run = (dir, ...args) => main(["--root", dir, ...args]);

// a project with the given files, verify checks, and map text
function project({ files = { "src/a.js": "export function a() {}\n", "src/b.js": "export const b = 1;\n" }, checks = ["runs-a", "runs-b"], map }) {
	const dir = tempDir("stack-agent-fmap-");
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	write(dir, ".stack-agent/verify.json", JSON.stringify({ checks: checks.map((name) => ({ name, type: "command", command: "node -v" })) }));
	write(dir, ".stack-agent/feature-map.md", map);
	return dir;
}
const git = (dir, ...args) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });

const MAP = `# Feature map\n\n${HEAD}| Do a | src/a.js#function a | call a() | runs-a |\n| Do b | src/b.js | use b | - |\n\n### Cases: Do a\n\n| Case | Expected | Check |\n| --- | --- | --- |\n| normal call | returns | runs-a |\n| bad input | throws | - |\n`;

test("parseCases reads a table under a Cases heading, with the same list and TODO rules as the main table", () => {
	const sections = parseCases(MAP);
	assert.equal(sections.length, 1);
	assert.equal(sections[0].feature, "Do a");
	assert.deepEqual(sections[0].cases.map((c) => [c.name, c.expected, c.checks]), [["normal call", "returns", ["runs-a"]], ["bad input", "throws", []]]);
	// the main table is not changed by the cases below it
	assert.equal(parseFeatureMap(MAP).length, 2);
});

test("a heading may be any level, in any letter case, with backticks and spaces, and a Thai name matches after normalisation", () => {
	const text = `${HEAD}| ส่งอีเมล | src/a.js | x | - |\n\n## \`CASES:\`   ส่งอีเมล  \n\n| Case | Expected | Check |\n| --- | --- | --- |\n| ok | sent | - |\n`;
	assert.equal(parseCases(text)[0].feature.normalize("NFC"), "ส่งอีเมล");
});

test("an escaped pipe stays in the cell, and a table inside a code fence is not read", () => {
	const rows = parseFeatureMap(`${HEAD}| Pipe | src/a.js | a \\| b | - |\n\n\`\`\`\n${HEAD}| Example | src/never.js | x | - |\n\`\`\`\n`);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].reach, "a | b");
	const fenced = parseCases("```\n### Cases: X\n\n| Case | Expected | Check |\n| --- | --- | --- |\n| a | b | - |\n```\n");
	assert.equal(fenced.length, 0);
});

test("a map with cases reports them in the last line, counts a feature covered by its cases, and still passes", () => {
	const r = run(project({ map: `${HEAD}| Do a | src/a.js | call a() | - |\n\n### Cases: Do a\n\n| Case | Expected | Check |\n| --- | --- | --- |\n| normal | ok | runs-a |\n| bad | err | - |\n` }));
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /feature-map: ok \(1 feature\(s\), 1 covered by verify checks, 2 case\(s\), 1 covered by checks\)/);
	assert.match(r.text, /warning: Do a \/ bad: no verify check covers this case/);
	assert.doesNotMatch(r.text, /Do a: no verify check covers it/, "the feature is covered through a case");
});

test("a map without a cases section prints the same last line as before", () => {
	const r = run(project({ map: `${HEAD}| Do a | src/a.js | call a() | runs-a |\n` }));
	assert.match(r.text, /^feature-map: ok \(1 feature\(s\), 1 covered by verify checks\)$/m);
});

test("cases fail the map when they name a missing feature or check, repeat a case, repeat a section, or sit under no Cases heading", () => {
	const table = (rows) => `\n| Case | Expected | Check |\n| --- | --- | --- |\n${rows}\n`;
	const map = `${HEAD}| Do a | src/a.js | call a() | runs-a |\n\n### Cases: Do a\n${table("| one | x | runs-a |\n| one | y | no-such-check |")}\n### Cases: Do a\n${table("| two | z | - |")}\n### Cases: Ghost\n${table("| g | z | - |")}\n### Notes\n${table("| orphan | z | - |")}`;
	const r = run(project({ map }));
	assert.equal(r.code, 1);
	assert.match(r.text, /Do a \/ one: listed twice/);
	assert.match(r.text, /Do a \/ one: no verify check named no-such-check/);
	assert.match(r.text, /Do a: more than one Cases section/);
	assert.match(r.text, /Cases: Ghost: no feature of that name in the table/);
	assert.match(r.text, /a Case table with no "Cases: <feature>" heading above it/);
});

test("a verify check that no row or case names is a warning, and two names that differ only in case or spacing are a possible duplicate", () => {
	const r = run(project({ checks: ["runs-a", "runs-b", "orphan-check"], map: `${HEAD}| Do a | src/a.js | call a() | runs-a |\n| do  A | src/b.js | call b() | runs-b |\n` }));
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /warning: verify check orphan-check is in no row or case/);
	assert.match(r.text, /warning: do {2}A: may be the same feature as Do a/);
});

test("a Where path that leaves the repository, or differs from the file only in letter case, is drift on every system", () => {
	const dir = project({ files: { "src/Util.js": "export const u = 1;\n" }, checks: ["c"], map: `${HEAD}| Out | ../elsewhere.js | x | c |\n| Case | src/util.js | x | c |\n| Exact | src/Util.js | x | c |\n` });
	const r = run(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /Out: \.\.\/elsewhere\.js is outside the repository/);
	// Windows and macOS find src/util.js; Linux does not. Either way the map must not pass.
	assert.match(r.text, /Case: src\/util\.js (differs from the real file name in letter case|does not exist)/);
	assert.doesNotMatch(r.text, /Exact:/);
});

test("a project that still has the older vendored tool keeps its drift check: the older reader ignores a Case table", () => {
	// the reader as it was before cases existed (scripts/feature-map.mjs up to 0.6.0), frozen here
	const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().replace(/^`|`$/g, ""));
	function oldParse(text) {
		const rows = [];
		let inTable = false;
		for (const line of text.split(/\r?\n/)) {
			if (!line.trim().startsWith("|")) { inTable = false; continue; }
			const c = cells(line);
			if (/^feature$/i.test(c[0])) { inTable = true; continue; }
			if (!inTable || /^:?-+:?$/.test(c[0])) continue;
			rows.push(c[0]);
		}
		return rows;
	}
	assert.deepEqual(oldParse(MAP), ["Do a", "Do b"]);
});

test("backticks around a whole cell are dropped, but one that only starts or ends part of the text stays", () => {
	const [row] = parseFeatureMap(`${HEAD}| \`--top\` left out | \`src/a.js\` | run \`x\` | \`runs-a\`, runs-b |\n`);
	assert.equal(row.feature, "`--top` left out");
	assert.deepEqual(row.where, ["src/a.js"]);
	assert.equal(row.reach, "run `x`");
	assert.deepEqual(row.checks, ["runs-a", "runs-b"]);
});

test("CRLF line endings read the same as LF", () => {
	assert.equal(parseCases(MAP.replace(/\n/g, "\r\n"))[0].cases.length, 2);
	assert.equal(parseFeatureMap(MAP.replace(/\n/g, "\r\n")).length, 2);
});

test("--suggest names where a moved file, a moved anchor, and a renamed check went, and edits nothing", () => {
	const dir = project({ files: { "src/old/a.js": "export function a() {}\n", "src/b.js": "export const fancyFlag = 1;\n" }, checks: ["runs-a", "runs-b"], map: `${HEAD}| Do a | src/old/a.js | x | runs-a |\n| Do b | src/b.js#fancyFlag | x | runs-b |\n` });
	assert.equal(git(dir, "init", "-q").status, 0);
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "start");
	fs.mkdirSync(path.join(dir, "src/new"), { recursive: true });
	assert.equal(git(dir, "mv", "src/old/a.js", "src/new/a.js").status, 0);
	write(dir, "src/b.js", "export const other = 1;\n");
	write(dir, "src/c.js", "export const fancyFlag = 1;\n");
	write(dir, ".stack-agent/verify.json", JSON.stringify({ checks: [{ name: "runs-a-now", type: "command", command: "node -v" }, { name: "runs-b", type: "command", command: "node -v" }] }));
	const before = fs.readFileSync(path.join(dir, ".stack-agent/feature-map.md"), "utf8");
	const r = run(dir, "--suggest");
	assert.equal(r.code, 1);
	assert.match(r.text, /suggestion: Do a: src\/old\/a\.js may now be src\/new\/a\.js/);
	assert.match(r.text, /suggestion: Do b: "fancyFlag" is now in src\/c\.js/);
	assert.match(r.text, /suggestion: Do a: runs-a, did you mean runs-a-now/);
	assert.equal(fs.readFileSync(path.join(dir, ".stack-agent/feature-map.md"), "utf8"), before, "the map file is untouched");
});

test("--suggest works outside git, skips binary and node_modules, and --json carries the suggestions", () => {
	const dir = project({ files: { "src/b.js": "export const x = 1;\n", "node_modules/p/hit.js": "export const fancyFlag = 1;\n", "src/bin.dat": "fancyFlag\u0000\u0001" }, checks: ["c"], map: `${HEAD}| Do b | src/b.js#fancyFlag | x | c |\n| Moved | src/gone/util.js | x | c |\n` });
	write(dir, "lib/util.js", "export const u = 1;\n");
	const r = run(dir, "--suggest", "--json");
	const out = JSON.parse(r.text);
	assert.equal(out.ok, false);
	assert.ok(out.suggestions.some((s) => /src\/gone\/util\.js may now be lib\/util\.js/.test(s)), JSON.stringify(out.suggestions));
	assert.ok(!out.suggestions.some((s) => /node_modules|bin\.dat/.test(s)), "vendored and binary files are not searched");
	assert.equal(typeof out.cases, "number");
});

test("with no verify.json at all, every check a row names is drift, as before", () => {
	const dir = tempDir("stack-agent-fmap-");
	write(dir, "src/a.js", "x\n");
	write(dir, ".stack-agent/feature-map.md", `${HEAD}| Do a | src/a.js | x | runs-a |\n`);
	const r = run(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /Do a: no verify check named runs-a/);
});
