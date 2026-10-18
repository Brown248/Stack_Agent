import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main as guard } from "../scripts/guard.mjs";
import { main as verify } from "../scripts/verify.mjs";
import { copyExample, repoRoot, runNode, write } from "./helpers.mjs";

const hasPython = spawnSync("python", ["--version"], { encoding: "utf8" }).status === 0;
const skip = hasPython ? false : "python is not on PATH";

test("the Python CLI passes its own full verification", { skip }, async () => {
	const dir = copyExample("sample-cli");
	const r = await verify(["--root", dir]);
	assert.equal(r.code, 0, r.text);
	assert.match(r.text, /PASS check main-path: python -m wordfreq samples\/poem\.txt --top 2 -> exit 0/);
	const latest = JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/evidence/latest.json"), "utf8"));
	assert.equal(latest.full, true);
});

test("a behavior change in the Python CLI fails verification even when unit tests pass", { skip }, async () => {
	const dir = copyExample("sample-cli");
	const cli = path.join(dir, "wordfreq/cli.py");
	fs.writeFileSync(cli, fs.readFileSync(cli, "utf8").replace('print(f"{count}\\t{word}")', 'print(f"{word}: {count}")'));
	const r = await verify(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /PASS tests/);
	assert.match(r.text, /FAIL check main-path/);
});

test("the Python CLI's guard catches I/O in core.py", () => {
	const dir = copyExample("sample-cli");
	assert.equal(guard(["--root", dir]).code, 0);
	write(dir, "wordfreq/core.py", fs.readFileSync(path.join(dir, "wordfreq/core.py"), "utf8") + '\nprint("debug")\n');
	const r = guard(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /wordfreq\/core\.py:\d+ {2}\[core-is-pure\]/);
	assert.match(r.text, /do the I\/O in wordfreq\/cli\.py/);
});

test("init on the Python CLI keeps its config and reports a finished setup", () => {
	const dir = copyExample("sample-cli");
	const before = fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8");
	const init = path.join(repoRoot, "scripts/init.mjs");
	assert.equal(runNode(init, [dir, "--preset", "cli"]).code, 0);
	assert.equal(fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8"), before);
	const check = runNode(init, [dir, "--check"]);
	assert.equal(check.code, 0, check.stdout);
});
