import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main as apiMap } from "../scripts/api-map.mjs";
import { main as guard } from "../scripts/guard.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { copySample, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const initScript = path.join(repoRoot, "scripts", "init.mjs");

function guardProject(rules, files) {
	const dir = tempDir("stack-agent-r2-");
	write(dir, ".stack-agent/guard.config.json", JSON.stringify({ rules }));
	for (const [rel, text] of Object.entries(files)) write(dir, rel, text);
	return dir;
}

test("guard pattern rules are always multiline, so ^ matches every line", () => {
	const dir = guardProject([{ id: "no-print", type: "pattern", files: ["app/**"], pattern: "^\\s*print\\(", message: "m", fix: "f" }], { "app/core.py": "x = 1\n\n  print(x)\n" });
	const r = guard(["--root", dir, "--update-baseline"]);
	assert.match(r.text, /1 known violations/);
});

test("a pattern with a control character (a JSON \\b mistake) is a config error", () => {
	const dir = guardProject([{ id: "bad", type: "pattern", files: ["**"], pattern: "\bSELECT", message: "m", fix: "f" }], {});
	assert.throws(() => guard(["--root", dir]), (e) => e instanceof ConfigError && /control character/.test(e.message));
});

test("Python caches and virtualenvs are ignored by default", () => {
	const dir = guardProject([{ id: "no-print", type: "pattern", files: ["**"], pattern: "print\\(", message: "m", fix: "f" }], {
		"app/__pycache__/core.cpython-312.pyc.txt": "print(1)\n",
		".venv/lib/site.py": "print(1)\n",
		"app/core.py": "x = 1\n",
	});
	assert.equal(guard(["--root", dir]).code, 0);
});

test("api-map sources can fix the method for frameworks that declare one route per method", () => {
	const dir = copySample();
	write(dir, "src/extra.py", '@app.get("/py/items")\ndef items(): pass\n@app.post("/py/items")\ndef create(): pass\n');
	const file = path.join(dir, ".stack-agent/api-map.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.sources.push({ files: ["src/extra.py"], method: "GET", pattern: '@app\\.get\\("([^"]+)"' });
	fs.writeFileSync(file, JSON.stringify(config));
	const r = apiMap(["--root", dir]);
	assert.equal(r.code, 1);
	assert.match(r.text, /missing from map: GET \/py\/items \(defined at src\/extra\.py:1\)/);
	assert.doesNotMatch(r.text, /POST \/py\/items/);
});

test("a command check never counts as API-map coverage", () => {
	const dir = copySample();
	const file = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(file, "utf8"));
	config.checks = config.checks.filter((c) => c.name !== "list-items");
	config.checks.push({ name: "fake", type: "command", method: "GET", path: "/items", command: "node -v" });
	fs.writeFileSync(file, JSON.stringify(config));
	assert.match(apiMap(["--root", dir]).text, /no verify check covers GET \/items/);
});

test("init records the preset, reuses it, and refuses to mix in a different one", () => {
	const dir = tempDir("stack-agent-r2-");
	assert.equal(runNode(initScript, [dir, "--preset", "cli"]).code, 0);
	assert.equal(fs.readFileSync(path.join(dir, ".stack-agent/preset"), "utf8").trim(), "cli");
	assert.match(runNode(initScript, [dir]).stdout, /preset: cli/);
	const mixed = runNode(initScript, [dir, "--preset", "backend-http"]);
	assert.equal(mixed.code, 2);
	assert.match(mixed.stderr, /set up with preset cli; mixing in backend-http/);
	assert.equal(fs.existsSync(path.join(dir, ".stack-agent/api-map.json")), false);
});

test("init copies only known config files from a preset folder", () => {
	const stray = path.join(repoRoot, "templates/presets/cli/NOTES.md");
	assert.equal(fs.existsSync(stray), false);
	const dir = tempDir("stack-agent-r2-");
	runNode(initScript, [dir, "--preset", "cli"]);
	assert.deepEqual(fs.readdirSync(path.join(dir, ".stack-agent")).filter((f) => f.endsWith(".json")).sort(), ["guard.config.json", "verify.json"]);
});
