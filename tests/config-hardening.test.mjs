import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main as apiMap } from "../scripts/api-map.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { copySample, repoRoot, runNode, write } from "./helpers.mjs";

function setMapConfig(dir, patch) {
	const file = path.join(dir, ".stack-agent/api-map.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	Object.assign(config.sources[0], patch);
	fs.writeFileSync(file, JSON.stringify(config));
}

test("api-map: a pattern without the method/path groups is a config error, not a crash", () => {
	const dir = copySample();
	setMapConfig(dir, { pattern: 'route\\("(?:GET|POST)"', methodGroup: 1, pathGroup: 2 });
	assert.throws(() => apiMap(["--root", dir]), (e) => e instanceof ConfigError && /must capture the method in group 1/.test(e.message));
});

test("api-map: string files and empty matches are reported clearly", () => {
	const dir = copySample();
	setMapConfig(dir, { files: "src/routes.js" });
	assert.throws(() => apiMap(["--root", dir]), /must be an array of strings/);
	setMapConfig(dir, { files: ["src/nowhere/*.js"] });
	const r = apiMap(["--root", dir]);
	assert.match(r.text, /warning: source \["src\/nowhere\/\*\.js"\] matches no files/);
});

test("api-map: a zero-length-capable pattern does not loop forever", () => {
	const dir = copySample();
	setMapConfig(dir, { pattern: "(GET)?()", methodGroup: 1, pathGroup: 2 });
	assert.throws(() => apiMap(["--root", dir]), ConfigError);
});

test("init recognises existing evidence ignore lines in their common spellings", () => {
	for (const line of [".stack-agent/evidence", "/.stack-agent/evidence/", ".stack-agent/evidence/**"]) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-agent-gi-"));
		write(dir, ".gitignore", line + "\n");
		runNode(path.join(repoRoot, "scripts/init.mjs"), [dir]);
		assert.equal(fs.readFileSync(path.join(dir, ".gitignore"), "utf8"), line + "\n", line);
	}
});
