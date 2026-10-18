import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main } from "../scripts/guard.mjs";
import { ConfigError, globToRegExp } from "../scripts/lib/files.mjs";
import { copySample, git, write } from "./helpers.mjs";

const guard = (dir, ...args) => main(["--root", dir, ...args]);
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test("globToRegExp handles *, ** and literal dots", () => {
	assert.ok(globToRegExp("src/**/*.js").test("src/a/b/c.js"));
	assert.ok(globToRegExp("src/**/*.js").test("src/c.js"));
	assert.ok(!globToRegExp("src/*.js").test("src/a/c.js"));
	assert.ok(!globToRegExp("src/*.js").test("src/cxjs"));
	assert.ok(globToRegExp("src/modules/**").test("src/modules/items/controller.js"));
});

test("the sample passes because its legacy violation is in the baseline", () => {
	const dir = copySample();
	const r = guard(dir);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /1 known violation/);
});

test("--strict ignores the baseline and reports the legacy violation", () => {
	const r = guard(copySample(), "--strict");
	assert.equal(r.code, 1);
	assert.match(r.text, /src\/modules\/reports\/controller\.js:1 {2}\[module-boundary\]/);
});

test("pattern rule flags SQL in a controller", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", 'export const q = "SELECT * FROM items WHERE id = 1";\n');
	const r = guard(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /controller\.js:1 {2}\[no-sql-in-controller\]/);
	assert.match(r.text, /fix: {3}move the query into src\/modules\/<module>\/repository\.js/);
});

test("forbidden-import flags a controller importing db", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", 'import { table } from "../../db.js";\nexport const t = table;\n');
	const r = guard(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /\[controller-no-db\]/);
	assert.match(r.text, /imports \.\.\/\.\.\/db\.js/);
});

test("forbidden-import also matches require() and extensionless specifiers", () => {
	const dir = copySample();
	write(dir, "src/modules/items/service.js", 'const db = require("../../db");\n');
	assert.equal(guard(dir).code, 1);
});

test("module-boundary allows the public index and flags internals", () => {
	const dir = copySample();
	write(dir, "src/modules/orders/service.js", 'import { getItems } from "../items/index.js";\nexport const x = getItems;\n');
	assert.equal(guard(dir).code, 0);
	write(dir, "src/modules/orders/service.js", 'import { insertItem } from "../items/repository.js";\nexport const x = insertItem;\n');
	const r = guard(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /orders\/service\.js:1 {2}\[module-boundary\]/);
});

test("ratchet: a second violation in a baselined file fails, fixing it reports an improvement", () => {
	const dir = copySample();
	const file = "src/modules/reports/controller.js";
	const original = fs.readFileSync(path.join(dir, file), "utf8");
	write(dir, file, original + 'import { insertItem } from "../items/repository.js";\n');
	const worse = guard(dir);
	assert.equal(worse.code, 1);
	assert.match(worse.text, /baseline allows 1/);
	write(dir, file, 'import { getItems } from "../items/index.js";\nexport const s = getItems;\n');
	const better = guard(dir);
	assert.equal(better.code, 0);
	assert.match(better.text, /improved: src\/modules\/reports\/controller\.js \[module-boundary\] 1 -> 0/);
});

test("--update-baseline refuses to raise counts without --allow-increase", () => {
	const dir = copySample();
	write(dir, "src/modules/orders/controller.js", 'import { insertItem } from "../items/repository.js";\n');
	const refused = guard(dir, "--update-baseline");
	assert.equal(refused.code, 1);
	assert.match(refused.text, /refusing to raise the baseline/);
	const forced = guard(dir, "--update-baseline", "--allow-increase");
	assert.equal(forced.code, 0);
	const baseline = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/guard-baseline.json"), "utf8"));
	assert.equal(baseline.counts["module-boundary"]["src/modules/orders/controller.js"], 1);
});

test("--update-baseline lowers counts freely and drops fixed entries", () => {
	const dir = copySample();
	write(dir, "src/modules/reports/controller.js", 'import { getItems } from "../items/index.js";\nexport const s = getItems;\n');
	assert.equal(guard(dir, "--update-baseline").code, 0);
	const baseline = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/guard-baseline.json"), "utf8"));
	assert.deepEqual(baseline.counts, {});
});

test("the first --update-baseline records existing violations without --allow-increase", () => {
	const dir = copySample();
	fs.rmSync(path.join(dir, ".stack-agent/guard-baseline.json"));
	assert.equal(guard(dir).code, 1);
	assert.equal(guard(dir, "--update-baseline").code, 0);
	assert.equal(guard(dir).code, 0);
});

test("a valid stack-agent-allow comment suppresses the next line", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", `// stack-agent-allow no-sql-in-controller reason="report export, ticket 42" until=${inDays(30)} by=lead\nexport const q = "SELECT id FROM items";\n`);
	assert.equal(guard(dir).code, 0);
});

test("an expired or incomplete allow comment fails", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", '// stack-agent-allow no-sql-in-controller reason="old" until=2000-01-01 by=lead\nexport const q = "SELECT id FROM items";\n');
	const expired = guard(dir);
	assert.equal(expired.code, 1);
	assert.match(expired.text, /expired on 2000-01-01/);
	assert.match(expired.text, /\[no-sql-in-controller\]/);
	write(dir, "src/modules/items/controller.js", '// stack-agent-allow no-sql-in-controller reason="no approver"\nexport const q = "SELECT id FROM items";\n');
	assert.match(guard(dir).text, /missing until, by/);
});

test("--files limits the scan to the given files", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", 'export const q = "DELETE FROM items";\n');
	assert.equal(guard(dir, "--files", "src/modules/items/service.js").code, 0);
	assert.equal(guard(dir, "--files", "src/modules/items/controller.js").code, 1);
});

test("--json reports failing pairs and violations", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", 'export const q = "DELETE FROM items";\n');
	const out = JSON.parse(guard(dir, "--json").text);
	assert.equal(out.ok, false);
	assert.equal(out.failing[0].rule, "no-sql-in-controller");
	assert.equal(out.violations[0].line, 1);
});

test("config without a fix line is rejected", () => {
	const dir = copySample();
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ rules: [{ id: "x", type: "pattern", files: ["**"], pattern: "a", message: "m" }] }));
	assert.throws(() => guard(dir), (err) => err instanceof ConfigError && /fix are required/.test(err.message));
});

test("config with a bad regex or unknown type is rejected", () => {
	const dir = copySample();
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ rules: [{ id: "x", type: "pattern", files: ["**"], pattern: "(", message: "m", fix: "f" }] }));
	assert.throws(() => guard(dir), /bad pattern/);
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ rules: [{ id: "x", type: "nope", message: "m", fix: "f" }] }));
	assert.throws(() => guard(dir), /type must be one of/);
});

test("brace globs match each alternative", () => {
	assert.ok(globToRegExp("src/*/controller.{js,ts}").test("src/items/controller.ts"));
	assert.ok(globToRegExp("src/*/controller.{js,ts}").test("src/items/controller.js"));
	assert.ok(!globToRegExp("src/*/controller.{js,ts}").test("src/items/controller.mjs"));
	const dir = copySample();
	const file = path.join(dir, ".stack-agent/guard.config.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.rules[0].files = ["src/modules/*/controller.{js,ts}"];
	fs.writeFileSync(file, JSON.stringify(config));
	write(dir, "src/modules/items/controller.js", 'export const q = "SELECT * FROM items";\n');
	assert.equal(guard(dir).code, 1);
});

test("a rule whose globs match no file produces a warning", () => {
	const dir = copySample();
	const file = path.join(dir, ".stack-agent/guard.config.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.rules[0].files = ["src/controllers/**"];
	fs.writeFileSync(file, JSON.stringify(config));
	assert.match(guard(dir).text, /warning: rule no-sql-in-controller matches no files/);
});

test("string values where arrays are expected are config errors, not crashes", () => {
	const dir = copySample();
	const file = path.join(dir, ".stack-agent/guard.config.json");
	for (const [key, value] of [["to", "src/db"], ["files", "src/**"], ["toSpecifiers", "pg"]]) {
		const config = JSON.parse(fs.readFileSync(path.join(copySample(), ".stack-agent/guard.config.json"), "utf8"));
		config.rules[1][key] = value;
		fs.writeFileSync(file, JSON.stringify(config));
		assert.throws(() => guard(dir), (e) => e instanceof ConfigError && /must be an array of strings/.test(e.message), key);
	}
});

test("allow comments: unknown rule, impossible date, and too-distant expiry are rejected", () => {
	const dir = copySample();
	const cases = [
		["no-such-rule", inDays(10), /unknown rule no-such-rule/],
		["no-sql-in-controller", "2099-13-45", /must be a real date/],
		["no-sql-in-controller", inDays(400), /more than maxAllowDays \(90\)/],
	];
	for (const [rule, until, expected] of cases) {
		write(dir, "src/modules/items/controller.js", `// stack-agent-allow ${rule} reason="r" until=${until} by=lead\nexport const q = "SELECT id FROM items";\n`);
		const r = guard(dir);
		assert.equal(r.code, 1, until);
		assert.match(r.text, expected);
	}
});

test("a trailing allow comment covers only its own line", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", `export const a = "SELECT id FROM items"; // stack-agent-allow no-sql-in-controller reason="r" until=${inDays(10)} by=lead\nexport const b = "SELECT name FROM items";\n`);
	const r = guard(dir, "--json");
	const out = JSON.parse(r.text);
	assert.deepEqual(out.violations.map((v) => v.line), [2]);
});

test("imports inside comments are ignored and lines point at the import itself", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", '// import { table } from "../../db.js";\n/* require("../../db.js") */\nexport const ok = 1;\n');
	assert.equal(guard(dir).code, 0);
	write(dir, "src/modules/items/controller.js", 'export function helper() { return 1 }\n\nimport { table } from "../../db.js";\n');
	const out = JSON.parse(guard(dir, "--json").text);
	assert.equal(out.violations[0].line, 3);
	write(dir, "src/modules/items/controller.js", 'const u = "http://example.com/x";\nimport { table } from "../../db.js";\n');
	assert.equal(JSON.parse(guard(dir, "--json").text).violations[0].line, 2, "a // inside a string is not a comment");
});

test("template-literal dynamic imports and query suffixes are still resolved", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", "export const load = () => import(`../../db.js`);\n");
	assert.equal(guard(dir).code, 1);
	write(dir, "src/modules/items/controller.js", 'import { table } from "../../db.js?x=1";\n');
	assert.equal(guard(dir).code, 1);
});

test("aliases let rules see path-alias imports", () => {
	const dir = copySample();
	write(dir, "src/modules/orders/service.js", 'import { insertItem } from "@/modules/items/repository.js";\n');
	assert.equal(guard(dir).code, 0, "without aliases the alias import is invisible");
	const file = path.join(dir, ".stack-agent/guard.config.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.aliases = { "@/": "src/" };
	fs.writeFileSync(file, JSON.stringify(config));
	const r = guard(dir);
	assert.equal(r.code, 1);
	assert.match(r.text, /orders\/service\.js:1 {2}\[module-boundary\]/);
});

test("vendored tools under .stack-agent/bin are never scanned", () => {
	const dir = copySample();
	write(dir, ".stack-agent/bin/guard.mjs", 'const x = "stack-agent-allow for ${m}";\n');
	const file = path.join(dir, ".stack-agent/guard.config.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.rules[0].files = [".stack-agent/**/*.mjs", "src/modules/*/controller.js"];
	fs.writeFileSync(file, JSON.stringify(config));
	assert.equal(guard(dir).code, 0);
});

test("--compare-ref fails when the baseline grows or a rule is removed or narrowed", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	assert.equal(guard(dir, "--compare-ref", "HEAD").code, 0);

	const baselineFile = path.join(dir, ".stack-agent/guard-baseline.json");
	const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf8"));
	baseline.counts["module-boundary"]["src/modules/reports/controller.js"] = 5;
	fs.writeFileSync(baselineFile, JSON.stringify(baseline));
	const grown = guard(dir, "--compare-ref", "HEAD");
	assert.equal(grown.code, 1);
	assert.match(grown.text, /baseline grew: module-boundary src\/modules\/reports\/controller\.js 1 -> 5/);
	git(dir, "checkout", "--", ".stack-agent/guard-baseline.json");

	const configFile = path.join(dir, ".stack-agent/guard.config.json");
	const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
	config.rules[0].files = ["src/nowhere/**"];
	config.rules.splice(1, 1);
	fs.writeFileSync(configFile, JSON.stringify(config));
	const loosened = guard(dir, "--compare-ref", "HEAD");
	assert.equal(loosened.code, 1);
	assert.match(loosened.text, /rule removed: controller-no-db/);
	assert.match(loosened.text, /rule changed scope: no-sql-in-controller/);
	assert.throws(() => guard(dir, "--compare-ref", "no-such-ref"), /not a commit/);
});
