// The A/B run of 2026-10-23 found the against step skipping with "verify.json does not exist" in projects whose
// path was long: `git show <full hash>:<path>` also tried the argument as a file name, which passed Windows'
// 260-character limit. The test builds a project at such a path; the limit only exists on Windows.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runAgainst } from "../scripts/verify.mjs";
import { git, tempDir, write } from "./helpers.mjs";

test("the against step reads the old verify.json at a full hash from a project with a long path", { skip: process.platform !== "win32" && "the 260-character path limit is Windows only" }, async () => {
	let dir = tempDir("stack-agent-long-");
	// 200 characters: cwd plus "<40-character hash>:.stack-agent/verify.json" is over 260, while git's own object
	// files (.git/objects/xx/<38 characters>) still fit under it
	while (dir.length < 200) dir = path.join(dir, "d".repeat(Math.min(40, 200 - dir.length - 1)));
	fs.mkdirSync(dir, { recursive: true });
	const check = (name, needle) => ({ name, args: ["node", "-e", `process.exit(require('fs').readFileSync('src/x.js','utf8').includes('${needle}') ? 0 : 1)`] });
	write(dir, ".stack-agent/verify.json", JSON.stringify({ checks: [check("old", "x")] }));
	write(dir, "src/x.js", "export const x = 1;\n");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	const hash = git(dir, "rev-parse", "HEAD").trim();
	assert.ok(dir.length + 1 + `${hash}:.stack-agent/verify.json`.length > 260);
	write(dir, "src/x.js", "export const x = 1;\nexport const added = 2;\n");
	const config = { checks: [check("old", "x"), check("new", "added")] };
	const step = await runAgainst({ root: dir, config, ref: hash });
	assert.equal(step.skipped, undefined, JSON.stringify(step));
	assert.deepEqual(step.detecting, ["new"]);
});
