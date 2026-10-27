// guard behaviors that had no test of their own: rule flags, config errors, a custom publicEntry, files the scan
// skips, and the baseline messages.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main } from "../scripts/guard.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { git, tempDir, write } from "./helpers.mjs";

const guard = (dir, ...args) => main(["--root", dir, ...args]);
const rule = (extra) => ({ id: "no-todo", type: "pattern", files: ["src/**"], pattern: "todo", message: "m", fix: "f", ...extra });

function project(config, files = {}) {
	const dir = tempDir("stack-agent-gcov-");
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	write(dir, ".stack-agent/guard.config.json", JSON.stringify(config));
	return dir;
}

test("a pattern rule's flags apply: i makes it match any case", () => {
	const files = { "src/a.js": "// TODO: later\n" };
	assert.equal(guard(project({ rules: [rule()] }, files)).code, 0, "case-sensitive by default");
	const r = guard(project({ rules: [rule({ flags: "i" })] }, files));
	assert.equal(r.code, 1);
	assert.match(r.text, /src\/a\.js:1 {2}\[no-todo\]/);
});

test("rule config errors say what is wrong", () => {
	const cases = [
		[[rule({ id: "No_Todo" })], /rule "No_Todo": id must be kebab-case/],
		[[rule(), rule()], /rule "no-todo": duplicate id/],
		[[rule({ fix: "" })], /message and fix are required/],
		[[rule({ pattern: undefined })], /pattern rules need a pattern string/],
		[[{ id: "no-db", type: "forbidden-import", files: ["src/**"], message: "m", fix: "f" }], /forbidden-import rules need to\[\] or toSpecifiers\[\]/],
		[[{ id: "mods", type: "module-boundary", message: "m", fix: "f" }], /module-boundary rules need modulesRoot/],
		[[rule({ onEdit: "later" })], /onEdit can only be "skip"/],
	];
	for (const [rules, re] of cases) assert.throws(() => guard(project({ rules })), (e) => e instanceof ConfigError && re.test(e.message), String(re));
});

test("extends nested more than 5 levels deep is refused", () => {
	const dir = tempDir("stack-agent-gcov-");
	git(dir, "init", "-q");
	for (let i = 1; i <= 6; i++) write(dir, `shared/s${i}.json`, JSON.stringify({ ...(i < 6 && { extends: [`s${i + 1}.json`] }), rules: [rule({ id: `r${i}` })] }));
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ extends: ["../shared/s1.json"], rules: [rule()] }));
	assert.throws(() => guard(dir), (e) => e instanceof ConfigError && /extends is nested more than 5 levels deep/.test(e.message));
});

test("a module-boundary rule's publicEntry replaces the default index files", () => {
	const config = { rules: [{ id: "mods", type: "module-boundary", modulesRoot: "src/modules", publicEntry: ["api.js"], message: "m", fix: "f" }] };
	const base = { "src/modules/b/api.js": "export const x = 1;\n", "src/modules/b/internal.js": "export const y = 2;\n", "src/modules/b/index.js": "export const z = 3;\n" };
	assert.equal(guard(project(config, { ...base, "src/modules/a/x.js": 'import { x } from "../b/api.js";\n' })).code, 0);
	const viaIndex = guard(project(config, { ...base, "src/modules/a/x.js": 'import { z } from "../b/index.js";\n' }));
	assert.equal(viaIndex.code, 1, "index.js is no longer public once publicEntry names api.js");
	assert.match(guard(project(config, { ...base, "src/modules/a/x.js": 'import { y } from "../b/internal.js";\n' })).text, /\[mods\]/);
});

test("binary files and symbolic links are skipped, not read", (t) => {
	const dir = project({ rules: [rule()] }, { "src/clean.js": "ok\n" });
	fs.writeFileSync(path.join(dir, "src/blob.bin"), Buffer.from("todo\0\x01\x02todo"));
	assert.equal(guard(dir).code, 0, "a file with a NUL byte is binary");
	write(dir, "outside/note.txt", "todo\n");
	try {
		fs.symlinkSync(path.join(dir, "outside/note.txt"), path.join(dir, "src/link.txt"));
	} catch {
		t.diagnostic("no permission to create a symbolic link here; the symlink half is skipped");
		return;
	}
	assert.equal(guard(dir).code, 0, "a symbolic link is not followed");
});

test("baseline messages: --compare-ref on a first adoption, and --update-baseline with --files", () => {
	const dir = project({ rules: [rule()] }, { "src/a.js": "ok\n" });
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	const r = guard(dir, "--compare-ref", "HEAD");
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /guard-baseline\.json does not exist at HEAD; nothing to compare \(first adoption\)/);
	assert.throws(() => guard(dir, "--update-baseline", "--files", "src/a.js"), (e) => e instanceof ConfigError && /do not combine it with --files/.test(e.message));
});
