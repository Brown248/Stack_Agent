import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main, parseMap } from "../scripts/api-map.mjs";
import { copySample, write } from "./helpers.mjs";

const apiMap = (dir, ...args) => main(["--root", dir, ...args]);

function addRoute(dir, line) {
	const file = path.join(dir, "src/routes.js");
	fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("];", `\t${line},\n];`));
}

test("the sample map is in sync and every route has a verify check", () => {
	const r = apiMap(copySample());
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /4 route\(s\) mapped, 4 covered/);
});

test("a new route missing from the map is drift", () => {
	const dir = copySample();
	addRoute(dir, 'route("DELETE", "/items/:id", items.list)');
	const r = apiMap(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /missing from map: DELETE \/items\/:id \(defined at src\/routes\.js:\d+\)/);
	assert.match(r.text, /no verify check covers DELETE \/items\/:id/);
});

test("a map row with no route is stale, a wrong handler path is flagged", () => {
	const dir = copySample();
	const file = path.join(dir, ".stack-agent/api-map.md");
	fs.appendFileSync(file, "| PUT | /items/:id | src/modules/items/missing.js | x | items |\n");
	const r = apiMap(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /stale in map: PUT \/items\/:id/);
	assert.match(r.text, /bad handler path in map: PUT \/items\/:id/);
});

test("route params match concrete verify check paths", () => {
	const dir = copySample();
	addRoute(dir, 'route("GET", "/items/:id", items.list)');
	fs.appendFileSync(path.join(dir, ".stack-agent/api-map.md"), "| GET | /items/:id | src/modules/items/controller.js | items/service | items |\n");
	const verify = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(verify, "utf8"));
	config.checks.push({ name: "get-item", method: "GET", path: "/items/1?x=1", expectStatus: 200 });
	fs.writeFileSync(verify, JSON.stringify(config));
	const r = apiMap(dir);
	assert.equal(r.code, 0, r.text);
	assert.doesNotMatch(r.text, /no verify check covers GET \/items\/:id/);
});

test("--draft prints a table with TODO cells and TODO rows are flagged as unreviewed", () => {
	const dir = copySample();
	const draft = apiMap(dir, "--draft");
	assert.equal(draft.code, 0);
	assert.match(draft.text, /\| POST \| \/items \| src\/routes\.js:\d+ \| TODO \| TODO \|/);
	write(dir, ".stack-agent/api-map.md", draft.text.replaceAll("src/routes.js:", "src/routes.js#") .replace(/src\/routes\.js#\d+/g, "src/routes.js"));
	const r = apiMap(dir);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /still has TODO cells/);
});

test("parseMap ignores header, separator, and prose rows", () => {
	const rows = parseMap("# t\n| Method | Path |\n| --- | --- |\n| get | `/a` | f.js | c | o |\nsome | text\n");
	assert.deepEqual(rows, [{ method: "GET", path: "/a", handler: "f.js", calls: "c", owner: "o" }]);
});
