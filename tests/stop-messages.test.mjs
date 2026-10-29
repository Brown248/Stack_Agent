import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MAX_BLOCKS, SKIP_MARKER, coverageMessage, guardMessage, importMessage, reminderMessage } from "../scripts/hooks/stop-verify.mjs";
import { repoRoot } from "./helpers.mjs";

const THAI = /[฀-๿]/;
const golden = JSON.parse(fs.readFileSync(path.join(repoRoot, "tests", "fixtures", "stop-messages.json"), "utf8"));
const many = Array.from({ length: 12 }, (_, i) => `src/a${i}.js:${i + 1} [r] m; fix: f`);
const files = Array.from({ length: 12 }, (_, i) => `src/f${i}.js`);

// every message the Stop hook sends the agent, with the arguments the golden file was made from
const calls = {
	"remind.block": (lang) => reminderMessage({ why: "there is no verify evidence yet", files: ["src/a.js"], verifyConfigChanged: false, mode: "block", attempt: 2, lang }),
	"remind.block.configChanged": (lang) => reminderMessage({ why: "the code changed after the last verify", files, verifyConfigChanged: true, mode: "block", attempt: 1, lang }),
	"remind.once": (lang) => reminderMessage({ why: "there is no verify evidence yet", files: ["src/a.js", "src/b.js"], verifyConfigChanged: false, mode: "remind", lang }),
	"guard.few": (lang) => guardMessage(["a.js:1 [r] m; fix: f", "b.js:2 [r] m; fix: f"], 2, lang),
	"guard.many": (lang) => guardMessage(many, 1, lang),
	"coverage.none": (lang) => coverageMessage([], lang),
	"coverage.files": (lang) => coverageMessage(["src/a.js", "src/b.js"], lang),
	"coverage.many": (lang) => coverageMessage(files, lang),
	"import.none": (lang) => importMessage([], lang),
	"import.names": (lang) => importMessage(["monthlyTotals", "other"], lang),
};

test("in English the Stop hook's messages to the agent are what they were before the catalog, character for character", () => {
	assert.deepEqual(Object.keys(calls).sort(), Object.keys(golden).sort());
	for (const [name, call] of Object.entries(calls)) {
		assert.equal(call(), golden[name], name);
		assert.equal(call("en"), golden[name], name);
	}
});

test("in Thai they keep every command, path, flag, and marker the agent has to use exactly as written", () => {
	for (const [name, call] of Object.entries(calls)) {
		const thai = call("th");
		assert.match(thai, THAI, name);
		assert.notEqual(thai, golden[name], name);
		// whatever is in backticks in the English text (a command, a JSON snippet) is in the Thai text too
		for (const [, code] of golden[name].matchAll(/`([^`]+)`/g)) assert.ok(thai.includes(code), `${name}: ${code} is missing from:\n${thai}`);
	}
	const block = calls["remind.block"]("th");
	assert.ok(block.includes("there is no verify evidence yet"), "the reason it was given is kept as it was");
	assert.ok(block.includes("src/a.js"));
	assert.ok(block.includes(`${SKIP_MARKER} <reason>`));
	assert.ok(block.includes(`Stop 2`) || block.includes("2 จาก"), "the count of stops is there");
	assert.ok(block.includes(String(MAX_BLOCKS)));
	const guard = calls["guard.many"]("th");
	for (const line of many.slice(0, 10)) assert.ok(guard.includes(line), line);
	assert.ok(!guard.includes(many[10]), "only ten violations are listed");
	assert.match(guard, /guard\.mjs/);
	assert.ok(calls["import.names"]("th").includes("import { monthlyTotals } from './src/<module>.js'"));
});

test("a message the agent reads is not translated unless its Thai version is on the measured list", async () => {
	const { AGENT_THAI, agentLang } = await import("../scripts/lib/messages.mjs");
	for (const key of ["remind", "guard", "coverage", "import"]) {
		assert.equal(agentLang("th", key), AGENT_THAI.has(key) ? "th" : "en", key);
		assert.equal(agentLang("en", key), "en", key);
	}
});
