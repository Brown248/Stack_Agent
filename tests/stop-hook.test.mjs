import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parsePorcelainZ, reminderMessage } from "../scripts/hooks/stop-verify.mjs";
import { copySample, git, repoRoot, runNode, write } from "./helpers.mjs";

const stopHook = path.join(repoRoot, "scripts", "hooks", "stop-verify.mjs");
const run = (cwd) => runNode(stopHook, [], { input: JSON.stringify({ hook_event_name: "Stop", cwd }) });

test("stop hook works when the backend is a subdirectory of the git repo, and from a deeper cwd", () => {
	const mono = copySample();
	const backend = path.join(mono, "services", "backend");
	fs.mkdirSync(backend, { recursive: true });
	for (const entry of fs.readdirSync(mono)) if (entry !== "services") fs.renameSync(path.join(mono, entry), path.join(backend, entry));
	write(mono, "README.md", "monorepo\n");
	git(mono, "init", "-q");
	git(mono, "add", "-A");
	git(mono, "commit", "-qm", "base");

	write(backend, "src/modules/items/service.js", "export const changed = true;\n");
	write(mono, "other/tool.js", "export {};\n");
	const fromBackend = run(backend);
	assert.equal(fromBackend.code, 2, fromBackend.stderr);
	assert.match(fromBackend.stderr, /src\/modules\/items\/service\.js/);
	assert.doesNotMatch(fromBackend.stderr, /other\/tool\.js/, "files outside the backend do not count");

	write(backend, "src/modules/items/repository.js", "export const changed = true;\n");
	assert.equal(run(path.join(backend, "src", "modules")).code, 2, "a cwd below the project root still finds .stack-agent/verify.json");
});

test("parsePorcelainZ keeps the new path of a rename and handles spaces and non-ASCII names", () => {
	const z = ["R  new name.js", "old.js", " M src/ไฟล์.js", "?? a b.js", ""].join("\0");
	assert.deepEqual(parsePorcelainZ(z), ["new name.js", "src/ไฟล์.js", "a b.js"]);
});

test("a renamed file counts as changed under its new name", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	git(dir, "mv", "src/modules/items/service.js", "src/modules/items/item-service.js");
	const r = run(dir);
	assert.equal(r.code, 2, r.stderr);
	assert.match(r.stderr, /item-service\.js/);
});

test("the reminder asks for a new verify check only when verify.json did not change", () => {
	const base = { why: "there is no verify evidence yet", files: ["src/modules/items/service.js"] };
	const without = reminderMessage({ ...base, verifyConfigChanged: false });
	assert.match(without, /\.stack-agent\/verify\.json has no new check in this change set/);
	assert.match(without, /the success case and at least one rejection case/);
	assert.match(without, /Then run the full verification/);
	const withCheck = reminderMessage({ ...base, verifyConfigChanged: true });
	assert.doesNotMatch(withCheck, /has no new check/);
	assert.match(withCheck, /Before you finish, run the full verification/);
});

test("in a real repo the hook asks for a check after a code-only change, and not once verify.json changed too", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	write(dir, "src/modules/items/service.js", fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8") + "\n");
	const codeOnly = run(dir);
	assert.equal(codeOnly.code, 2, codeOnly.stderr);
	assert.match(codeOnly.stderr, /has no new check in this change set/);

	const verifyFile = path.join(dir, ".stack-agent/verify.json");
	const config = JSON.parse(fs.readFileSync(verifyFile, "utf8"));
	config.checks.push({ name: "new-behavior", method: "GET", path: "/health", expectStatus: 200 });
	fs.writeFileSync(verifyFile, JSON.stringify(config, null, 2));
	write(dir, "src/modules/items/repository.js", fs.readFileSync(path.join(dir, "src/modules/items/repository.js"), "utf8") + "\n");
	const withCheck = run(dir);
	assert.equal(withCheck.code, 2, withCheck.stderr);
	assert.doesNotMatch(withCheck.stderr, /has no new check/);
});
