import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { MAX_BLOCKS, decideBlock, skipMessage } from "../scripts/hooks/stop-verify.mjs";
import { MESSAGES, agentLanguageNote, languageFor, t } from "../scripts/lib/messages.mjs";
import { copySample, freePort, git, repoRoot, runNode, tempDir, usePort, write } from "./helpers.mjs";

const THAI = /[฀-๿]/;
const hook = (name) => path.join(repoRoot, "scripts", "hooks", name);
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("languageFor: English unless the environment or verify.json says Thai, and the environment wins", () => {
	assert.equal(languageFor({}, {}), "en");
	assert.equal(languageFor({ language: "th" }, {}), "th");
	assert.equal(languageFor({}, { STACK_AGENT_LANG: "th" }), "th");
	assert.equal(languageFor({ language: "th" }, { STACK_AGENT_LANG: "en" }), "en");
	assert.equal(languageFor({ language: "en" }, { STACK_AGENT_LANG: "TH" }), "th");
	// a value nobody knows is English, never an error: a hook must not fail on a display setting
	assert.equal(languageFor({ language: "thai" }, {}), "en");
	assert.equal(languageFor({ language: 5 }, {}), "en");
	assert.equal(languageFor(null, { STACK_AGENT_LANG: "" }), "en");
	assert.equal(languageFor({ language: "th" }, { STACK_AGENT_LANG: "" }), "th", "an empty variable is not a choice");
});

test("the English and Thai catalogs have the same messages with the same placeholders", () => {
	assert.deepEqual(Object.keys(MESSAGES.th).sort(), Object.keys(MESSAGES.en).sort());
	for (const key of Object.keys(MESSAGES.en)) {
		assert.deepEqual(placeholders(MESSAGES.th[key]), placeholders(MESSAGES.en[key]), `${key}: placeholders differ`);
		assert.match(MESSAGES.th[key], THAI, `${key}: the Thai text has no Thai in it`);
		assert.doesNotMatch(MESSAGES.en[key], THAI, `${key}: the English text has Thai in it`);
	}
});

test("t fills placeholders once, so text from outside is never read as a placeholder", () => {
	assert.equal(t("en", "release.unverified", { max: 3, list: "{max}, {list}" }).includes("{max}, {list}"), true);
	assert.throws(() => t("en", "release.unverified", { max: 3 }), /list/);
	assert.throws(() => t("en", "no.such.message", {}), /no\.such\.message/);
	assert.throws(() => t("fr", "release.unverified", { max: 3, list: "x" }), /fr/);
});

test("English is exactly what the hooks said before there was a language option", () => {
	assert.equal(
		t("en", "tools.differ", { vendored: "0.1.0", plugin: "0.6.0", shown: "guard.mjs, VERSION", initScript: "/p/scripts/init.mjs", root: "/r" }),
		"stack-agent: the tools in .stack-agent/bin (version 0.1.0) differ from this plugin's copy (version 0.6.0): guard.mjs, VERSION. " +
			"The hooks run the plugin's copy and CI runs .stack-agent/bin, so they can judge the same code differently. " +
			'Refresh them with `node "/p/scripts/init.mjs" "/r"` (it rewrites only the tools) and commit the result.',
	);
	assert.equal(
		t("en", "release.guard", { max: 3, list: "a.js:1 [r] m; fix: f" }),
		"stack-agent: stopping with guard violations after 3 reminders: a.js:1 [r] m; fix: f. Fix them before trusting this change; CI will fail on them.",
	);
	assert.equal(
		t("en", "release.unverified", { max: 3, list: "src/a.js, src/b.js" }),
		"stack-agent: stopping with unverified changes after 3 reminders (src/a.js, src/b.js). Run node .stack-agent/bin/verify.mjs before trusting this change.",
	);
	assert.equal(
		skipMessage("en", { reason: "  no db  ", via: "message", written: false }),
		'stack-agent: the agent stopped without verifying and said why in its final message: "no db"',
	);
	assert.equal(
		skipMessage("en", { reason: "no db", via: "message", written: true }),
		'stack-agent: the agent stopped without verifying and recorded why in .stack-agent/verify-skip.json: "no db"',
	);
});

test("Thai messages keep commands, paths, and the agent's own words exactly as they are", () => {
	const tools = t("th", "tools.differ", { vendored: "0.1.0", plugin: "0.6.0", shown: "guard.mjs, VERSION", initScript: "/p/scripts/init.mjs", root: "/r" });
	for (const keep of ['node "/p/scripts/init.mjs" "/r"', ".stack-agent/bin", "0.1.0", "0.6.0", "guard.mjs, VERSION"]) assert.ok(tools.includes(keep), `${keep} is missing from: ${tools}`);
	assert.match(t("th", "release.unverified", { max: 3, list: "src/a.js" }), /node \.stack-agent\/bin\/verify\.mjs/);
	assert.ok(t("th", "release.guard", { max: 3, list: "a.js:1 [r] m; fix: f" }).includes("a.js:1 [r] m; fix: f"));
	const skipped = skipMessage("th", { reason: "the database server is not installed here", via: "file" });
	assert.ok(skipped.includes('"the database server is not installed here"'));
	assert.ok(skipped.includes(".stack-agent/verify-skip.json"));
	assert.match(skipMessage("th", { reason: "the database server is not installed here", via: "message", written: false }), /ข้อความสุดท้าย/);
	assert.doesNotMatch(skipMessage("th", { reason: "the database server is not installed here", via: "message", written: true }), /ข้อความสุดท้าย/);
});

test("every message stays well under the 10,000 characters Claude Code accepts", () => {
	const long = "x".repeat(300);
	for (const lang of ["en", "th"]) {
		assert.ok(t(lang, "tools.differ", { vendored: "0.1.0", plugin: "0.6.0", shown: "a, b, c, d, ...", initScript: "x".repeat(200), root: "y".repeat(200) }).length < 2000);
		assert.ok(skipMessage(lang, { reason: long, via: "file" }).length < 2000);
	}
});

test("the note to the agent exists only for Thai, and says what is set rather than giving orders", () => {
	assert.equal(agentLanguageNote("en"), null);
	const note = agentLanguageNote("th");
	assert.match(note, /Thai/);
	assert.match(note, /verify\.json|STACK_AGENT_LANG/);
	assert.doesNotMatch(note, /^(you must|always|never)\b/i);
	assert.ok(note.length < 1500);
});

// the decision functions take the language as data, so they can be read without running a hook
test("decideBlock releases in the chosen language, and a skip says where the reason was kept", () => {
	const current = { value: "now", entries: new Map() };
	const base = { root: repoRoot, files: ["README.md"], ignore: [], current, sessionStart: { fingerprint: "before", dirty: {} } };
	const guard = { ...base, guardFailures: ["a.js:1 [r] m; fix: f"] };
	let state = {};
	for (let i = 1; i <= MAX_BLOCKS; i++) state = decideBlock({ ...guard, state, stopHookActive: i > 1 }).state;
	assert.match(decideBlock({ ...guard, state, stopHookActive: true }).message, /^stack-agent: stopping with guard violations/);
	assert.match(decideBlock({ ...guard, state, stopHookActive: true, lang: "th" }).message, THAI);

	const skip = { reason: "the database server is not installed", fingerprint: "now", via: "message", written: false };
	assert.match(decideBlock({ ...base, skip }).message, /said why in its final message/);
	const th = decideBlock({ ...base, skip, lang: "th" });
	assert.match(th.message, THAI);
	assert.ok(th.message.includes("the database server is not installed"));
});

async function repo(language) {
	const dir = copySample();
	usePort(dir, await freePort());
	if (language) {
		const file = path.join(dir, ".stack-agent/verify.json");
		write(dir, ".stack-agent/verify.json", JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), language }, null, 2));
	}
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	return dir;
}

const run = (name, dir, extra = {}, env) => runNode(hook(name), [], { input: JSON.stringify({ cwd: dir, session_id: "s1", ...extra }), env });

test("the Stop hook's release message is Thai when verify.json says so, and English when the environment says so", async () => {
	for (const [language, env, expectThai] of [["th", undefined, true], [undefined, { STACK_AGENT_LANG: "th" }, true], ["th", { STACK_AGENT_LANG: "en" }, false], [undefined, undefined, false]]) {
		const dir = await repo(language);
		run("session-start.mjs", dir, {}, env);
		write(dir, "src/modules/items/service.js", fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8") + "\n");
		for (let n = 1; n <= MAX_BLOCKS; n++) assert.equal(run("stop-verify.mjs", dir, { stop_hook_active: n > 1 }, env).code, 2);
		const released = run("stop-verify.mjs", dir, { stop_hook_active: true }, env);
		assert.equal(released.code, 0, released.stderr);
		const { systemMessage } = JSON.parse(released.stdout);
		assert.equal(THAI.test(systemMessage), expectThai, systemMessage);
		assert.match(systemMessage, /node \.stack-agent\/bin\/verify\.mjs/);
	}
});

test("what the agent is told when it is blocked stays English whatever the language", async () => {
	const dir = await repo("th");
	run("session-start.mjs", dir);
	write(dir, "src/modules/items/service.js", fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8") + "\n");
	const blocked = run("stop-verify.mjs", dir);
	assert.equal(blocked.code, 2);
	assert.doesNotMatch(blocked.stderr, THAI);
	assert.match(blocked.stderr, /Stop 1 of 3/);
});

test("SessionStart in Thai tells the agent the language and the human the tool notice, and says nothing in English", () => {
	const dir = tempDir();
	git(dir, "init", "-q");
	assert.equal(runNode(path.join(repoRoot, "scripts/init.mjs"), [dir]).code, 0);
	// quiet and unchanged by default
	assert.equal(run("session-start.mjs", dir).stdout, "");
	// Thai: the note reaches the agent as context only, and nothing is shown to the human when nothing differs
	const quiet = JSON.parse(run("session-start.mjs", dir, { session_id: "s2" }, { STACK_AGENT_LANG: "th" }).stdout);
	assert.deepEqual(Object.keys(quiet), ["hookSpecificOutput"]);
	assert.equal(quiet.hookSpecificOutput.hookEventName, "SessionStart");
	assert.equal(quiet.hookSpecificOutput.additionalContext, agentLanguageNote("th"));
	// a stale tool brings the notice to the human in Thai and in English
	fs.appendFileSync(path.join(dir, ".stack-agent/bin/guard.mjs"), "// older copy\n");
	const english = JSON.parse(run("session-start.mjs", dir, { session_id: "s3" }).stdout);
	assert.deepEqual(Object.keys(english), ["systemMessage"], "the English output keeps its shape");
	assert.doesNotMatch(english.systemMessage, THAI);
	const th = JSON.parse(run("session-start.mjs", dir, { session_id: "s4" }, { STACK_AGENT_LANG: "th" }).stdout);
	assert.match(th.systemMessage, THAI);
	assert.ok(th.systemMessage.includes("guard.mjs"));
	assert.equal(th.hookSpecificOutput.additionalContext, agentLanguageNote("th"));
});
