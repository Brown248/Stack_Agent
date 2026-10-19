import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main as guard } from "../scripts/guard.mjs";
import { main as verify } from "../scripts/verify.mjs";
import { copyExample, freePort, repoRoot, runNode, usePort, write } from "./helpers.mjs";

const initScript = path.join(repoRoot, "scripts/init.mjs");

const examples = {
	"sample-library": { preset: "library", passes: [/PASS check build: node scripts\/build\.mjs -> exit 0/, /PASS check example-as-a-user: node examples\/basic\.mjs -> exit 0/] },
	"sample-frontend": { preset: "frontend-web", passes: [/PASS server: ready/, /PASS check home-page: GET \/ -> 200/, /PASS check e2e: node scripts\/e2e\.mjs -> exit 0/] },
	"sample-generic": { preset: "generic", passes: [/PASS check smoke: node job\.mjs data\/expenses\.csv out\/totals\.csv -> exit 0/] },
};

async function copyWithPort(name) {
	const dir = copyExample(name);
	if (name === "sample-frontend") usePort(dir, await freePort());
	return dir;
}

function edit(dir, rel, from, to) {
	const file = path.join(dir, rel);
	const text = fs.readFileSync(file, "utf8");
	assert.ok(text.includes(from), `${rel} no longer contains ${JSON.stringify(from)}`);
	fs.writeFileSync(file, text.replace(from, to));
}

function latestEvidence(dir) {
	return JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8"));
}

for (const [name, { preset, passes }] of Object.entries(examples)) {
	test(`${name} passes its own guard and full verification`, async () => {
		const dir = await copyWithPort(name);
		const g = guard(["--root", dir]);
		assert.equal(g.code, 0, g.text);
		assert.doesNotMatch(g.text, /warning:/);
		const r = await verify(["--root", dir]);
		assert.equal(r.code, 0, r.text);
		assert.match(r.text, /PASS tests: node --test/);
		for (const re of passes) assert.match(r.text, re);
		const latest = latestEvidence(dir);
		assert.equal(latest.ok, true);
		assert.equal(latest.full, true);
	});

	test(`init on ${name} keeps its config, uses its recorded preset, and reports a finished setup`, () => {
		const dir = copyExample(name);
		assert.equal(fs.readFileSync(path.join(dir, ".stack-agent/preset"), "utf8").trim(), preset);
		const before = fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8");
		const r = runNode(initScript, [dir]);
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, new RegExp(`^preset: ${preset}$`, "m"));
		assert.equal(fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8"), before);
		const check = runNode(initScript, [dir, "--check"]);
		assert.equal(check.code, 0, check.stdout);
		assert.match(check.stdout, /setup complete/);
	});
}

test("a broken build fails the library's verification even when unit tests pass", async () => {
	const dir = copyExample("sample-library");
	edit(dir, "scripts/build.mjs", "{ recursive: true }", '{ recursive: true, filter: (src) => !/[\\\\/]internal$/.test(src) }');
	const r = await verify(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /PASS tests/);
	assert.match(r.text, /FAIL check build: node scripts\/build\.mjs -> exit 1/);
	assert.match(r.text, /build: dist\/ is broken/);
	assert.match(r.text, /FAIL check example-as-a-user/);
	const latest = latestEvidence(dir);
	assert.equal(latest.ok, false);
	assert.deepEqual(latest.steps.filter((s) => !s.ok).map((s) => s.name), ["build", "example-as-a-user"]);
});

test("the library's guard catches an example that imports internals", () => {
	const dir = copyExample("sample-library");
	write(dir, "examples/deep.mjs", 'import { foldAccents } from "../src/internal/normalize.js";\nconsole.log(foldAccents("é"));\n');
	const r = guard(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /examples\/deep\.mjs:1 {2}\[examples-use-public-api\]/);
	assert.match(r.text, /import from the package name \("tinyslug"\)/);
});

test("a wrong content type fails the frontend's verification even when unit tests pass", async () => {
	const dir = await copyWithPort("sample-frontend");
	edit(dir, "src/server/server.js", '".js": "text/javascript; charset=utf-8"', '".js": "text/plain; charset=utf-8"');
	const r = await verify(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /PASS tests/);
	assert.match(r.text, /PASS check home-page/);
	assert.match(r.text, /FAIL check e2e: node scripts\/e2e\.mjs -> exit 1/);
	assert.match(r.text, /\/app\.js is served as "text\/plain; charset=utf-8", so browsers will not run it as a module/);
	const latest = latestEvidence(dir);
	assert.equal(latest.ok, false);
	assert.deepEqual(latest.steps.filter((s) => !s.ok).map((s) => s.name), ["e2e"]);
});

test("the frontend's guard catches browser code that imports the server", () => {
	const dir = copyExample("sample-frontend");
	write(dir, "src/client/admin.js", 'import { createServer } from "../server/server.js";\nexport const start = createServer;\n');
	const r = guard(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /src\/client\/admin\.js:1 {2}\[client-not-import-server\]/);
	assert.match(r.text, /move what both sides need to src\/shared\//);
});

test("a miscounted summary fails the data job's verification even when unit tests pass", async () => {
	const dir = copyExample("sample-generic");
	edit(dir, "job.mjs", '.split("\\n").length - 1}', '.split("\\n").length}');
	const r = await verify(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /PASS tests/);
	assert.match(r.text, /FAIL check smoke: node job\.mjs data\/expenses\.csv out\/totals\.csv -> exit 0 \(output does not match/);
	assert.match(r.text, /wrote out\/totals\.csv \(4 categories\)/);
	const latest = latestEvidence(dir);
	assert.equal(latest.ok, false);
	assert.deepEqual(latest.steps.filter((s) => !s.ok).map((s) => s.name), ["smoke"]);
});

test("the data job's guard catches I/O in the transform", () => {
	const dir = copyExample("sample-generic");
	write(dir, "src/transform.js", fs.readFileSync(path.join(dir, "src/transform.js"), "utf8") + '\nconsole.log("debug");\n');
	const r = guard(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /src\/transform\.js:\d+ {2}\[transform-is-pure\]/);
	assert.match(r.text, /do the reading, writing, and printing in job\.mjs/);
});
