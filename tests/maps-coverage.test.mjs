// api-map and feature-map behaviors that had no test of their own (both run in CI).
import assert from "node:assert/strict";
import { test } from "node:test";
import { main as apiMap } from "../scripts/api-map.mjs";
import { main as featureMap } from "../scripts/feature-map.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { tempDir, write } from "./helpers.mjs";

const table = (rows) => ["| Method | Path | Handler | Calls | Owner |", "| --- | --- | --- | --- | --- |", ...rows].join("\n") + "\n";

function apiProject(config, files = {}) {
	const dir = tempDir("stack-agent-maps-");
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	write(dir, ".stack-agent/api-map.json", JSON.stringify(config));
	return dir;
}

test("api-map: a source with a fixed method captures only the path, and {id} paths match a concrete check path", () => {
	const config = { map: ".stack-agent/api-map.md", sources: [{ files: ["src/**/*.py"], pattern: '@get\\("([^"]+)"\\)', method: "get" }], verifyConfig: "checks.json" };
	const files = {
		"src/app.py": '@get("/items/{item_id}")\ndef item(item_id): ...\n',
		".stack-agent/api-map.md": table(["| GET | /items/{item_id} | src/app.py:1 | items | team |"]),
		"checks.json": JSON.stringify({ checks: [{ name: "one", method: "GET", path: "/items/42?full=1", expectStatus: 200 }] }),
	};
	const r = apiMap(["--root", apiProject(config, files)]);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /api-map: ok \(1 route\(s\) mapped, 1 covered by verify checks\)/, "verifyConfig points at checks.json, and {item_id} matches /items/42");
	const noCheck = apiMap(["--root", apiProject({ ...config, verifyConfig: undefined }, files)]);
	assert.match(noCheck.text, /warning: no verify check covers GET \/items\/\{item_id\}/);
});

test("api-map: config errors and a missing map file", () => {
	const ok = { files: ["src/**"], pattern: "x(a)(b)" };
	for (const [config, re] of [
		[{ sources: [ok] }, /needs map/],
		[{ map: "m.md", sources: [] }, /needs sources\[\]/],
		[{ map: "m.md", sources: [{ files: ["src/**"] }] }, /each source needs a pattern string/],
		[{ map: "m.md", sources: [{ files: ["src/**"], pattern: "(" }] }, /bad source pattern/],
		[{ map: "m.md", sources: [{ ...ok, method: "FETCH" }] }, /source method must be one of GET, POST/],
		[{ map: "m.md", sources: [{ ...ok, files: "src/**" }] }, /sources\[\]\.files must be an array of strings/],
	])
		assert.throws(() => apiMap(["--root", apiProject(config)]), (e) => e instanceof ConfigError && re.test(e.message), String(re));
	assert.throws(() => apiMap(["--root", apiProject({ map: "nowhere.md", sources: [ok] }, { "src/a.js": "" })]), (e) => e instanceof ConfigError && /map file not found: nowhere\.md\. Create it from --draft first/.test(e.message));
});

const featureTable = (rows) => ["# Feature map", "", "| Feature | Where | How a user reaches it | Check |", "| --- | --- | --- | --- |", ...rows].join("\n") + "\n";

function featureProject(map, { mapPath = ".stack-agent/feature-map.md" } = {}) {
	const dir = tempDir("stack-agent-maps-");
	write(dir, "src/a.js", "export function a() {}\n");
	write(dir, ".stack-agent/verify.json", JSON.stringify({ checks: [{ name: "runs-a", args: ["node", "-v"] }] }));
	write(dir, mapPath, map);
	return dir;
}

test("feature-map: a feature listed twice, one with no place, and a map with no Feature table", () => {
	const r = featureMap(["--root", featureProject(featureTable(["| Do a | src/a.js#function a | call a() | runs-a |", "| Do a | src/a.js | call a() | runs-a |", "| Nowhere | | ? | runs-a |"]))]);
	assert.equal(r.code, 1);
	assert.match(r.text, /Do a: listed twice/);
	assert.match(r.text, /Nowhere: no place in the Where column/);
	assert.throws(() => featureMap(["--root", featureProject("# Notes\n\n| Name | Value |\n| --- | --- |\n| x | y |\n")]), (e) => e instanceof ConfigError && /has no table with a "Feature" header row/.test(e.message));
});

test("feature-map: --map reads another file and --json reports the result as data", () => {
	const dir = featureProject(featureTable(["| Do a | src/a.js#function a | call a() | runs-a |", "| Do b | src/b.js | call b() | runs-b |"]), { mapPath: "docs/features.md" });
	assert.throws(() => featureMap(["--root", dir]), /feature map not found: \.stack-agent\/feature-map\.md/);
	const r = featureMap(["--root", dir, "--map", "docs/features.md", "--json"]);
	assert.equal(r.code, 1);
	const out = JSON.parse(r.text);
	assert.equal(out.ok, false);
	assert.equal(out.features, 2);
	assert.deepEqual(out.problems, ["Do b: src/b.js does not exist", "Do b: no verify check named runs-b"]);
});
