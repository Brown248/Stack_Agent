import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main } from "../scripts/guard.mjs";
import { copySample, git, tempDir, write } from "./helpers.mjs";

const guard = (dir, ...args) => main(["--root", dir, ...args]);
const CONTROLLER = "src/modules/reports/controller.js";
const baselineFile = (dir) => path.join(dir, ".stack-agent/guard-baseline.json");
const readBaseline = (dir) => JSON.parse(fs.readFileSync(baselineFile(dir), "utf8"));
const writeV1 = (dir) => fs.writeFileSync(baselineFile(dir), JSON.stringify({ version: 1, counts: { "module-boundary": { [CONTROLLER]: 1 } } }));
const widen = (dir) => {
	const text = fs.readFileSync(path.join(dir, CONTROLLER), "utf8").split("\n");
	text[0] = 'import { listItems, insertItem } from "../items/repository.js";';
	write(dir, CONTROLLER, text.join("\n"));
};

test("adding a name to an existing forbidden import fails the ratchet", () => {
	const dir = copySample();
	assert.equal(readBaseline(dir).version, 2);
	assert.equal(guard(dir).code, 0);
	widen(dir);
	const r = guard(dir);
	assert.equal(r.code, 1, r.text);
	assert.match(r.text, /inside module items, 2 names/);
	assert.match(r.text, /has 2 module-boundary violations \(each imported name counts\), baseline allows 1/);
});

test("default, namespace, and side-effect imports count once; named and destructured imports count each name", () => {
	const dir = copySample();
	const counts = (body) => {
		write(dir, "src/modules/orders/service.js", body);
		return JSON.parse(guard(dir, "--json", "--files", "src/modules/orders/service.js").text).failing[0]?.count ?? 0;
	};
	assert.equal(counts('import repo from "../items/repository.js";\n'), 1);
	assert.equal(counts('import * as repo from "../items/repository.js";\n'), 1);
	assert.equal(counts('import "../items/repository.js";\n'), 1);
	assert.equal(counts('import { a, b as c, } from "../items/repository.js";\n'), 2);
	assert.equal(counts('import repo, { a, b } from "../items/repository.js";\n'), 3);
	assert.equal(counts('import {\n  a,\n  b,\n  c\n} from "../items/repository.js";\n'), 3);
	assert.equal(counts('export { a, b } from "../items/repository.js";\n'), 2);
	assert.equal(counts('const repo = require("../items/repository.js");\n'), 1);
	assert.equal(counts('const { a, b: x } = require("../items/repository.js");\n'), 2);
	assert.equal(counts('const { a, b, c } = await import("../items/repository.js");\n'), 3);
});

test("python: from x import a, b counts each name, and widening it fails", () => {
	const dir = tempDir("stack-agent-py-widen-");
	for (const f of ["app/__init__.py", "app/db.py", "app/api/__init__.py"]) write(dir, f, "");
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ rules: [{ id: "api-no-db", type: "forbidden-import", files: ["app/api/**"], to: ["app/db.py"], message: "views must not touch the db", fix: "call a service" }] }));
	write(dir, "app/api/views.py", "from app.db import connect\n");
	assert.equal(guard(dir, "--update-baseline").code, 0);
	assert.deepEqual(readBaseline(dir), { version: 2, counts: { "api-no-db": { "app/api/views.py": 1 } } });
	write(dir, "app/api/views.py", "from app.db import connect, cursor\n");
	const r = guard(dir);
	assert.equal(r.code, 1, r.text);
	assert.match(r.text, /imports app\.db \(2 names\)/);
	write(dir, "app/api/views.py", "from app.db import *\n");
	assert.equal(guard(dir).code, 0, "a star import counts once");
});

test("a version 1 baseline keeps statement counting, warns, and upgrades without --allow-increase", () => {
	const dir = copySample();
	writeV1(dir);
	const r = guard(dir);
	assert.equal(r.code, 0);
	assert.match(r.text, /the baseline is version 1, which counts import statements/);
	widen(dir);
	assert.equal(guard(dir).code, 0, "a v1 baseline cannot see widening, which is why the note asks to upgrade");

	const clean = copySample();
	writeV1(clean);
	const up = guard(clean, "--update-baseline");
	assert.equal(up.code, 0, up.text);
	assert.match(up.text, /upgraded from version 1/);
	assert.deepEqual(readBaseline(clean), { version: 2, counts: { "module-boundary": { [CONTROLLER]: 1 } } });
	assert.doesNotMatch(guard(clean).text, /version 1/);
});

test("upgrading a version 1 baseline still refuses a new import statement", () => {
	const dir = copySample();
	writeV1(dir);
	write(dir, CONTROLLER, fs.readFileSync(path.join(dir, CONTROLLER), "utf8") + 'import { insertItem } from "../items/repository.js";\n');
	const r = guard(dir, "--update-baseline");
	assert.equal(r.code, 1);
	assert.match(r.text, /refusing to raise the baseline/);
});

test("an unknown baseline version is a config error", () => {
	const dir = copySample();
	fs.writeFileSync(baselineFile(dir), JSON.stringify({ version: 3, counts: {} }));
	assert.throws(() => guard(dir), /baseline version 3 is not supported/);
});

test("--compare-ref across a v1 -> v2 upgrade compares statement counts and flags only real growth", () => {
	const dir = copySample();
	writeV1(dir);
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	widen(dir);
	assert.equal(guard(dir, "--update-baseline", "--allow-increase").code, 0);
	const upgraded = guard(dir, "--compare-ref", "HEAD");
	assert.equal(upgraded.code, 0, upgraded.text);
	assert.match(upgraded.text, /is version 1 at HEAD and version 2 now/);
	assert.match(upgraded.text, /review: module-boundary src\/modules\/reports\/controller\.js was 1 statement\(s\) and is now 2 imported name\(s\)/);

	write(dir, CONTROLLER, fs.readFileSync(path.join(dir, CONTROLLER), "utf8") + 'import { getItems } from "../items/repository.js";\n');
	assert.equal(guard(dir, "--update-baseline", "--allow-increase").code, 0);
	const grown = guard(dir, "--compare-ref", "HEAD");
	assert.equal(grown.code, 1);
	assert.match(grown.text, /baseline grew: module-boundary src\/modules\/reports\/controller\.js 1 -> 2/);
});

test("--compare-ref fails when the baseline version goes down", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	writeV1(dir);
	const r = guard(dir, "--compare-ref", "HEAD");
	assert.equal(r.code, 1);
	assert.match(r.text, /baseline version went down: 2 -> 1/);
});
