import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main, parseFeatureMap, parsePlace } from "../scripts/feature-map.mjs";
import { copyExample, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const featureMap = (dir, ...args) => main(["--root", dir, ...args]);
const initScript = path.join(repoRoot, "scripts", "init.mjs");

test("parsePlace reads a path, path:line, and path#text", () => {
	assert.deepEqual(parsePlace("src/a.js"), { file: "src/a.js" });
	assert.deepEqual(parsePlace("src/a.js:12"), { file: "src/a.js", line: 12 });
	assert.deepEqual(parsePlace('src/index.html#<form id="split">'), { file: "src/index.html", anchor: '<form id="split">' });
});

test("parseFeatureMap reads only the table under a Feature header, with commas splitting places and checks", () => {
	const rows = parseFeatureMap("intro | not a table\n\n| Feature | Where | How a user reaches it | Check |\n| --- | --- | --- | --- |\n| Export | `src/a.js#x`, src/b.js:3 | Menu > Export | export-csv, - |\n| Later | TODO | TODO | TODO |\n");
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[0].where, ["src/a.js#x", "src/b.js:3"]);
	assert.deepEqual(rows[0].checks, ["export-csv"]);
	assert.deepEqual(rows[1].where, []);
	assert.deepEqual(rows[1].checks, []);
});

test("every non-backend example has a feature map that matches its code", () => {
	for (const name of ["sample-cli", "sample-frontend", "sample-library", "sample-generic"]) {
		const r = featureMap(path.join(repoRoot, "examples", name));
		assert.equal(r.code, 0, `${name}: ${r.text}`);
		assert.match(r.text, /feature-map: ok \(\d+ feature\(s\), \d+ covered by verify checks\)/);
	}
});

test("the map fails when a file, a line, an anchor, or a check it names is gone", () => {
	const dir = copyExample("sample-frontend");
	write(dir, "src/client/index.html", fs.readFileSync(path.join(dir, "src/client/index.html"), "utf8").replace('<form id="split">', '<form id="bill">'));
	const mapFile = path.join(dir, ".stack-agent/feature-map.md");
	fs.appendFileSync(mapFile, "| Gone file | src/nope.js | x | e2e |\n| Short file | src/shared/format.js:999 | x | e2e |\n| Unknown check | src/shared/format.js | x | no-such-check |\n");
	const r = featureMap(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /Split a bill with a tip: src\/client\/index\.html no longer contains "<form id=\\"split\\">"/);
	assert.match(r.text, /Gone file: src\/nope\.js does not exist/);
	assert.match(r.text, /Short file: src\/shared\/format\.js has no line 999/);
	assert.match(r.text, /Unknown check: no verify check named no-such-check/);
	assert.match(r.text, /feature-map: DRIFT \(4 problem\(s\)\)/);
});

test("a row with no check or with TODO cells is a warning, not drift", () => {
	const dir = copyExample("sample-generic");
	fs.appendFileSync(path.join(dir, ".stack-agent/feature-map.md"), "| Unchecked | job.mjs | TODO | - |\n");
	const r = featureMap(dir);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /warning: Unchecked: no verify check covers it/);
	assert.match(r.text, /warning: Unchecked: still has TODO cells/);
});

test("--draft lists one row per verify check, and a missing map is a config error", () => {
	const dir = copyExample("sample-cli");
	const draft = featureMap(dir, "--draft");
	assert.match(draft.text, /^\| Feature \| Where \| How a user reaches it \| Check \|$/m);
	assert.match(draft.text, /^\| rejects-bad-top \| TODO \| TODO \| rejects-bad-top \|$/m);
	fs.rmSync(path.join(dir, ".stack-agent/feature-map.md"));
	assert.throws(() => featureMap(dir), /feature map not found/);
});

test("init gives every preset without an API map a feature map template, vendors the tool, and --check reports its EDIT ME", () => {
	for (const preset of ["generic", "cli", "library", "frontend-web"]) {
		const dir = tempDir("stack-agent-init-");
		assert.equal(runNode(initScript, [dir, "--preset", preset]).code, 0);
		assert.ok(fs.existsSync(path.join(dir, ".stack-agent/feature-map.md")), preset);
		assert.ok(fs.existsSync(path.join(dir, ".stack-agent/bin/feature-map.mjs")), preset);
		assert.match(runNode(initScript, [dir, "--check"]).stdout, /\.stack-agent\/feature-map\.md: still has EDIT ME placeholders/, preset);
	}
	const backend = tempDir("stack-agent-init-");
	runNode(initScript, [backend, "--preset", "backend-http"]);
	assert.ok(!fs.existsSync(path.join(backend, ".stack-agent/feature-map.md")), "backend-http has the API map instead");
});

test("a project set up before the feature map existed does not get one on a rerun, and is not told its setup is unfinished", () => {
	const dir = copyExample("sample-generic");
	fs.rmSync(path.join(dir, ".stack-agent/feature-map.md"));
	assert.equal(runNode(initScript, [dir]).code, 0);
	assert.ok(!fs.existsSync(path.join(dir, ".stack-agent/feature-map.md")));
	assert.doesNotMatch(runNode(initScript, [dir, "--check"]).stdout, /feature-map/);
});

test("the CI template checks the feature map only when the project has one", () => {
	const text = fs.readFileSync(path.join(repoRoot, "templates/ci/stack-agent.yml"), "utf8");
	assert.match(text, /if: hashFiles\('\.stack-agent\/feature-map\.md'\) != ''\n\s+run: node \.stack-agent\/bin\/feature-map\.mjs/);
});
