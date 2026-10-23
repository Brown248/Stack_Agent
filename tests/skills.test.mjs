// Limits a skill must stay within for Claude Code to keep and route it. Sizes and the description rule come from
// obra/superpowers (tests/skill-size, tests/diagnosing-superpowers/test-skill-structure.sh, MIT).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { repoRoot } from "./helpers.mjs";

const skillsDir = path.join(repoRoot, "skills");
const skills = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const read = (name) => fs.readFileSync(path.join(skillsDir, name, "SKILL.md"), "utf8");
const field = (text, key) => new RegExp(`^${key}: (.*)$`, "m").exec(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "")?.[1] ?? null;

// After a compaction Claude Code re-attaches each skill cut at 20,000 characters; the rest is gone for the session.
const SKILL_LIMIT = 20000;
// The Agent Skills format caps a description at this length.
const DESCRIPTION_LIMIT = 1024;

test("every skill is named after its folder and has a description", () => {
	assert.ok(skills.length >= 10, skills.join(", "));
	for (const name of skills) {
		const text = read(name);
		assert.equal(field(text, "name"), name, `${name}: name`);
		assert.ok(field(text, "description"), `${name}: description`);
	}
});

test("every SKILL.md fits in what survives a compaction", () => {
	for (const name of skills) {
		const { length } = read(name);
		assert.ok(length < SKILL_LIMIT, `${name}/SKILL.md is ${length} characters; move detail into a file the skill points to`);
	}
});

// A description that summarizes the procedure gets followed instead of the skill (one that said "code review between
// tasks" got one review where the skill had two). The description names when to start; the steps live in the body.
test("descriptions say when to use a skill, not the steps it takes", () => {
	for (const name of skills) {
		const description = field(read(name), "description");
		assert.ok(description.length <= DESCRIPTION_LIMIT, `${name}: description is ${description.length} characters`);
		assert.doesNotMatch(description, /\b(then|steps?)\b/i, `${name}: the description reads as a procedure`);
		assert.match(description, /\bUse\b/, `${name}: the description names when to use it`);
	}
});
