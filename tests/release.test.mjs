// The version lives in three files, and the changelogs say what each version changed. A release that bumps one file
// and not the others ships a plugin whose VERSION stamp (init) and marketplace entry disagree.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { repoRoot } from "./helpers.mjs";

const json = (file) => JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8"));
const version = json(".claude-plugin/plugin.json").version;

test("plugin.json, marketplace.json, and package.json carry the same version", () => {
	assert.match(version, /^\d+\.\d+\.\d+$/);
	assert.equal(json("package.json").version, version, "package.json");
	const entry = json(".claude-plugin/marketplace.json").plugins.find((p) => p.name === json(".claude-plugin/plugin.json").name);
	assert.ok(entry, "marketplace.json lists the plugin");
	assert.equal(entry.version, version, "marketplace.json");
});

test("the newest release section in both changelogs is the current version", () => {
	for (const file of ["CHANGELOG.md", "CHANGELOG.th.md"]) {
		const headings = [...fs.readFileSync(path.join(repoRoot, file), "utf8").matchAll(/^## (\S+)/gm)].map((m) => m[1]);
		const released = headings.filter((h) => /^\d+\.\d+\.\d+$/.test(h));
		assert.equal(released[0], version, `${file}: the newest release section is ${released[0]}, the plugin is ${version}`);
	}
});
