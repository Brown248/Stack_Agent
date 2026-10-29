import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { classify } from "../scripts/hooks/pre-bash.mjs";
import { PROTECTED, askForProtected } from "../scripts/hooks/protected-paths.mjs";
import { AGENT_THAI, MESSAGES, renderVerdict, whatName } from "../scripts/lib/messages.mjs";
import { copySample, git, repoRoot, runNode, write } from "./helpers.mjs";

const THAI = /[฀-๿]/;
const golden = JSON.parse(fs.readFileSync(path.join(repoRoot, "tests", "fixtures", "pre-bash-reasons.json"), "utf8"));
const hook = (name) => path.join(repoRoot, "scripts", "hooks", name);

test("English verdicts are what the hooks said before the catalog, for every command in the table", () => {
	for (const [command, expected] of Object.entries(golden)) {
		const v = classify(command);
		assert.equal(v?.decision ?? null, expected?.decision ?? null, command);
		assert.equal(v?.reason ?? null, expected?.reason ?? null, command);
	}
});

test("a question for the human is asked in Thai, keeping the commands and files in it as they are", () => {
	const asks = Object.entries(golden).filter(([, v]) => v?.decision === "ask");
	assert.ok(asks.length >= 15);
	for (const [command, expected] of asks) {
		const thai = renderVerdict(classify(command), "th");
		assert.match(thai, THAI, command);
		assert.notEqual(thai, expected.reason, command);
		// whatever is in backticks in the English reason (a command, a flag) is in the Thai one too
		for (const [, code] of expected.reason.matchAll(/`([^`]+)`/g)) assert.ok(thai.includes(code), `${code} is missing from: ${thai}`);
	}
});

test("what the agent reads when it is denied stays English: its one measured case was at the ceiling and showed nothing", () => {
	assert.deepEqual([...AGENT_THAI].sort(), ["coverage", "import", "remind"], "a key joins this list only with a measured result in docs/design-notes.md");
	const denies = Object.entries(golden).filter(([, v]) => v?.decision === "deny");
	assert.ok(denies.length >= 6);
	for (const [command, expected] of denies) assert.equal(renderVerdict(classify(command), "th"), expected.reason, command);
});

test("every protected thing has a Thai name, and an unknown name is left as it is", () => {
	for (const { what } of PROTECTED) assert.match(whatName("th", what), THAI, what);
	for (const what of ["the shared guard rules (a file guard.config.json extends)", "the repo's local git hooks (.git/hooks)", "the verify evidence"]) assert.match(whatName("th", what), THAI, what);
	assert.equal(whatName("th", "some folder nobody listed"), "some folder nobody listed");
	assert.equal(whatName("en", "the guard rules"), "the guard rules");
	assert.ok(Object.keys(MESSAGES.en).some((k) => k.startsWith("what.")));
});

test("the setup hint reaches the human in Thai only when the template is unfilled, and carries the Edit or Write advice", () => {
	const plain = renderVerdict(askForProtected("the guard baseline"), "th");
	const template = renderVerdict(askForProtected("the guard rules"), "th");
	assert.match(template, /Edit/);
	assert.match(template, /Write/);
	assert.doesNotMatch(plain, /EDIT ME/);
	assert.match(template, /EDIT ME/);
});

function project(language) {
	const dir = copySample();
	if (language) {
		const file = path.join(dir, ".stack-agent/verify.json");
		write(dir, ".stack-agent/verify.json", JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), language }, null, 2));
	}
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	return dir;
}
const bash = (dir, command, env) => runNode(hook("pre-bash.mjs"), [], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd: dir, session_id: "s1" }), env });
const reasonOf = (r) => JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;

test("the PreToolUse hooks ask in Thai when verify.json or the environment says so, and in English otherwise", () => {
	const th = project("th");
	assert.match(reasonOf(bash(th, "git push --force origin main")), THAI);
	assert.doesNotMatch(reasonOf(bash(th, "git push --force origin main", { STACK_AGENT_LANG: "en" })), THAI);
	const plain = project();
	assert.doesNotMatch(reasonOf(bash(plain, "git push --force origin main")), THAI);
	assert.match(reasonOf(bash(plain, "git push --force origin main", { STACK_AGENT_LANG: "th" })), THAI);
	// outside a Stack Agent project the environment alone decides (the git rules apply only inside one, the rule
	// about Stack Agent's own files everywhere)
	const bare = project();
	fs.rmSync(path.join(bare, ".stack-agent"), { recursive: true, force: true });
	const guardFile = "echo x > .stack-agent/guard.config.json";
	assert.match(reasonOf(bash(bare, guardFile, { STACK_AGENT_LANG: "th" })), THAI);
	assert.doesNotMatch(reasonOf(bash(bare, guardFile)), THAI);
	// a denial is shown to the agent, so it stays English
	assert.doesNotMatch(reasonOf(bash(th, "git commit --no-verify -m x")), THAI);

	const edit = (dir, env) => runNode(hook("pre-edit-protect.mjs"), [], { input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: path.join(dir, ".stack-agent/guard-baseline.json") }, cwd: dir, session_id: "s1" }), env });
	assert.match(reasonOf(edit(th)), THAI);
	assert.doesNotMatch(reasonOf(edit(plain)), THAI);
});
