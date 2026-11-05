// The git-guardrails hook is a Node script with no packages, so it runs wherever Node does, with no jq and no bash. It
// is run here the way Claude Code runs a hook: JSON on stdin, exit 2 and a message on stderr to refuse.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { repoRoot } from "./helpers.mjs";

const script = path.join(repoRoot, "skills/git-guardrails/scripts/block-dangerous-git.mjs");
const { blocked } = await import(pathToFileURL(script).href);
const run = (command) => spawnSync(process.execPath, [script], { input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }), encoding: "utf8" });

test("it refuses the commands that destroy work or publish it, in the forms people write them", () => {
	const refused = {
		"git push": "git push",
		"git push origin main --force": "git push",
		"git -C ../other push": "git push",
		"git --no-pager push": "git push",
		'bash -c "git push origin main"': "git push",
		"npm test && git push": "git push",
		"git reset --hard HEAD~3": "git reset --hard",
		"git clean -fd": "git clean -f",
		"git clean -fdx": "git clean -f",
		"git clean --force": "git clean -f",
		"git branch -D feature": "git branch -D",
		"git branch --delete --force feature": "git branch -D",
		"git checkout .": "git checkout .",
		"git checkout -- .": "git checkout .",
		"git restore .": "git restore .",
		"C:/Program Files/Git/bin/git.exe push": "git push",
	};
	for (const [command, rule] of Object.entries(refused)) assert.equal(blocked(command), rule, command);
});

test("it lets ordinary git and look-alike text through", () => {
	for (const command of ["git status", "git log --oneline -5", "git diff main...HEAD", "git branch -d merged-one", "git checkout main", "git checkout -b feature", "git restore src/app.js", "git clean -n", "git reset HEAD file.txt", "git stash", "echo pushing is fun", "npm run push-docs", "mygit push"]) assert.equal(blocked(command), null, command);
	assert.equal(blocked(undefined), null);
});

test("as a hook it exits 2 with a BLOCKED message on stderr, and 0 with nothing for a harmless command or unreadable input", () => {
	const refused = run("git push origin main");
	assert.equal(refused.status, 2);
	assert.match(refused.stderr, /^BLOCKED: 'git push origin main'/);
	const fine = run("git status");
	assert.equal(fine.status, 0);
	assert.equal(fine.stderr, "");
	assert.equal(spawnSync(process.execPath, [script], { input: "not json", encoding: "utf8" }).status, 0);
	assert.equal(spawnSync(process.execPath, [script], { input: "", encoding: "utf8" }).status, 0);
});

test("the skill installs the hook for both shell tools, as a Node command with no jq", () => {
	const skill = fs.readFileSync(path.join(repoRoot, "skills/git-guardrails/SKILL.md"), "utf8");
	assert.match(skill, /"matcher": "Bash\|PowerShell"/);
	assert.match(skill, /"command": "node"/);
	assert.doesNotMatch(skill, /\bjq\b/);
	assert.ok(fs.existsSync(path.join(repoRoot, "skills/git-guardrails/scripts/block-dangerous-git.mjs")));
	assert.ok(!fs.existsSync(path.join(repoRoot, "skills/git-guardrails/scripts/block-dangerous-git.sh")), "the bash script that needed jq is gone");
});
