import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { bareName, count, installedSkills, main, report, skillEventsIn, subagentFiles } from "../scripts/skill-usage.mjs";
import { tempDir, write } from "./helpers.mjs";

const line = (o) => JSON.stringify(o);
let toolCalls = 0;
const use = (name, input, at, id = `toolu_${++toolCalls}`) => line({ type: "assistant", timestamp: at, message: { content: [{ type: "text", text: "ok" }, { type: "tool_use", id, name, input }] } });
const load = (skill, at = "2026-10-20T10:00:00Z") => use("Skill", { skill }, at);
const read = (file_path, at = "2026-10-20T10:00:00Z") => use("Read", { file_path }, at);
const user = (text, uuid) => line({ type: "user", uuid, timestamp: "2026-10-20T09:00:00Z", message: { content: text } });
const slash = (name, extra = {}) => line({ type: "user", timestamp: "2026-10-21T10:00:00Z", message: { content: `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>` }, ...extra });

// a project with two skills of its own, and a folder standing in for a plugin's skills
function skillsFolder(...names) {
	const dir = tempDir("stack-agent-skills-");
	for (const n of names) write(dir, `${n}/SKILL.md`, `---\nname: ${n}\ndescription: Use for ${n}.\n---\n`);
	write(dir, "notes/README.md", "a folder with no SKILL.md is not a skill");
	return dir;
}

test("bareName drops the plugin prefix and a leading slash", () => {
	assert.equal(bareName("stack-agent:debug"), "debug");
	assert.equal(bareName("/stack-agent:debug"), "debug");
	assert.equal(bareName("debug"), "debug");
});

test("installedSkills lists folders that hold a SKILL.md, in every folder given, and ignores a missing folder", () => {
	const a = skillsFolder("debug", "verify");
	const b = skillsFolder("verify", "reflect");
	const names = [...installedSkills([a, b, path.join(a, "missing")]).keys()].sort();
	assert.deepEqual(names, ["debug", "reflect", "verify"]);
});

test("skillEventsIn finds Skill tool calls, slash commands, and reads into a skill's folder, and nothing else", () => {
	const text = [
		load("stack-agent:debug", "2026-10-20T10:00:00Z"),
		read("D:\\proj\\.claude\\skills\\api-map\\SKILL.md"),
		read("/home/me/proj/skills/verify/references/x.md"),
		read("D:\\proj\\src\\skills.js"),
		read("D:\\proj\\src\\skills\\index.js"),
		use("Bash", { command: "ls skills/debug/" }),
		slash("stack-agent:reflect"),
		slash("model"),
		slash("stack-agent:correct", { isMeta: true }),
		slash("stack-agent:verify", { isSidechain: true }),
		"not json at all with \"Skill\" in it",
		line({ type: "user", message: { content: "the user typed Skill and /debug, no command tag" } }),
	].join("\n");
	assert.deepEqual(
		skillEventsIn(text).map((e) => `${e.kind}:${e.name}`),
		["load:stack-agent:debug", "view:api-map", "view:verify", "slash:stack-agent:reflect", "slash:model"],
	);
});

test("count merges a skill's names, ignores slash commands that are not skills, and keeps each skill's last use", () => {
	const project = skillsFolder("debug", "api-map", "correct");
	const transcripts = tempDir("stack-agent-usage-");
	write(transcripts, "s1.jsonl", [load("stack-agent:debug", "2026-10-20T10:00:00Z"), load("debug", "2026-10-22T10:00:00Z"), slash("stack-agent:correct"), slash("model"), slash("clear")].join("\n"));
	write(transcripts, "s2.jsonl", [load("debug", "2026-10-25T10:00:00Z"), read("D:\\p\\.claude\\skills\\api-map\\SKILL.md", "2026-10-26T10:00:00Z"), load("superpowers:brainstorming", "2026-10-24T10:00:00Z")].join("\n"));
	const files = ["s1.jsonl", "s2.jsonl"].map((n) => path.join(transcripts, n));
	const r = count({ files, known: installedSkills([project]) });
	assert.equal(r.sessions, 2);
	const by = Object.fromEntries([...r.used, ...r.viewedOnly, ...r.unused].map((x) => [x.name, x]));
	assert.deepEqual({ loads: by.debug.loads, sessions: by.debug.sessions, last: by.debug.last }, { loads: 3, sessions: 2, last: "2026-10-25T10:00:00Z" });
	assert.deepEqual({ slash: by.correct.slash, loads: by.correct.loads, sessions: by.correct.sessions }, { slash: 1, loads: 0, sessions: 1 });
	assert.equal(by.brainstorming.installed, false, "used through the Skill tool, though it is in no folder listed");
	assert.deepEqual(r.used.map((x) => x.name), ["debug", "brainstorming", "correct"], "most used first, then by name");
	assert.deepEqual(r.viewedOnly.map((x) => [x.name, x.views]), [["api-map", 1]]);
	assert.deepEqual(r.unused, []);
	assert.ok(!by.model && !by.clear, "/model and /clear are not skills");
});

test("a skill nobody loaded, ran, or read is unused, but only said so once there are enough sessions", () => {
	const project = skillsFolder("debug", "feature-map");
	const transcripts = tempDir("stack-agent-usage-");
	for (let i = 0; i < 3; i++) write(transcripts, `s${i}.jsonl`, load("debug"));
	const files = fs.readdirSync(transcripts).map((n) => path.join(transcripts, n));
	const few = count({ files, known: installedSkills([project]), minSessions: 5 });
	assert.equal(few.enough, false);
	assert.deepEqual(few.unused.map((x) => x.name), ["feature-map"]);
	assert.match(report(few), /not used so far: feature-map\n\(only 3 session\(s\), fewer than 5: too few to call any skill unused\)/);
	const many = count({ files, known: installedSkills([project]), minSessions: 3 });
	assert.equal(many.enough, true);
	assert.match(report(many), /not used in 3 session\(s\): feature-map\n\(a skill kept for a rare job can be fine; this lists, it does not say remove\)/);
});

test("only sessions changed within --days are counted", () => {
	const project = skillsFolder("debug");
	const transcripts = tempDir("stack-agent-usage-");
	write(transcripts, "new.jsonl", load("debug"));
	write(transcripts, "old.jsonl", load("debug"));
	const old = new Date(Date.now() - 60 * 86400000);
	fs.utimesSync(path.join(transcripts, "old.jsonl"), old, old);
	const files = ["new.jsonl", "old.jsonl"].map((n) => path.join(transcripts, n));
	assert.equal(count({ files, known: installedSkills([project]), days: 30 }).used[0].loads, 1);
	assert.equal(count({ files, known: installedSkills([project]), days: 90 }).used[0].loads, 2);
});

test("the command reports this plugin's skills and the project's, as text or JSON, and refuses bad input", () => {
	const project = tempDir("stack-agent-proj-");
	write(project, ".claude/skills/local-skill/SKILL.md", "---\nname: local-skill\ndescription: Use for local things.\n---\n");
	const transcripts = tempDir("stack-agent-usage-");
	write(transcripts, "a.jsonl", [load("stack-agent:verify"), load("local-skill"), slash("stack-agent:reflect")].join("\n"));
	const text = main(["--project", project, "--transcripts", transcripts]).text;
	assert.match(text, /^1 session\(s\) from the last 30 day\(s\)\nused:/);
	assert.match(text, /\n {2}verify: loaded 1, slash command 0, in 1 session\(s\), last 2026-10-20\n/);
	assert.match(text, /\n {2}reflect: loaded 0, slash command 1, in 1 session\(s\)/);
	assert.match(text, /not used so far: .*\bdebug\b/, "this plugin's other skills are listed too");
	assert.doesNotMatch(text.split("not used")[1], /local-skill|verify|reflect/);
	const json = JSON.parse(main(["--project", project, "--transcripts", transcripts, "--json", "--min-sessions", "1"]).text);
	assert.equal(json.enough, true);
	assert.deepEqual(json.used.map((x) => x.name).sort(), ["local-skill", "reflect", "verify"]);
	const extra = skillsFolder("my-extra");
	assert.ok(main(["--project", project, "--transcripts", transcripts, "--skills", extra]).text.includes("my-extra"));
	assert.throws(() => main(["--project", tempDir("stack-agent-none-")]), /no Claude Code transcripts for/);
	assert.throws(() => main(["--transcripts", transcripts, "--days", "0"]), /--days must be a positive number/);
	assert.throws(() => main(["--transcripts", transcripts, "--min-sessions", "0"]), /--min-sessions must be a whole number/);
	assert.match(main(["--help"]).text, /^usage: node skill-usage\.mjs/);
});

// a resumed session starts with a copy of the one it continues; 4,422 of 6,942 user events on one real project were repeats
test("a copy of an earlier session is not another session, and what it repeats is counted once", () => {
	const project = skillsFolder("debug", "feature-map");
	const transcripts = tempDir("stack-agent-usage-");
	const first = [user("start", "u1"), load("stack-agent:debug", "2026-10-20T10:00:00Z", "toolu_same"), slash("stack-agent:feature-map", { uuid: "u2" })];
	write(transcripts, "original.jsonl", first.join("\n"));
	// the resumed file holds the same events again, then one new
	write(transcripts, "resumed.jsonl", [...first, user("go on", "u3"), load("debug", "2026-10-28T10:00:00Z", "toolu_new")].join("\n"));
	write(transcripts, "pure-copy.jsonl", first.join("\n"));
	const old = new Date(Date.now() - 5 * 86400000);
	fs.utimesSync(path.join(transcripts, "original.jsonl"), old, old);
	fs.utimesSync(path.join(transcripts, "pure-copy.jsonl"), new Date(Date.now() - 4 * 86400000), new Date(Date.now() - 4 * 86400000));
	const files = fs.readdirSync(transcripts).map((n) => path.join(transcripts, n));
	const r = count({ files, known: installedSkills([project]) });
	const by = Object.fromEntries([...r.used, ...r.unused].map((x) => [x.name, x]));
	assert.equal(r.sessions, 2, "the original and the resumed one; the pure copy adds nothing");
	assert.equal(by.debug.loads, 2, "the repeated call once, the new call once");
	assert.equal(by["feature-map"].slash, 1);
	assert.equal(by.debug.sessions, 2);
});

test("a copy that adds a skill call but no user message still has that call counted, in whichever order the files were changed", () => {
	const project = skillsFolder("debug");
	const transcripts = tempDir("stack-agent-usage-");
	const a = [user("start", "u1"), load("debug", "2026-10-20T10:00:00Z", "toolu_1")];
	write(transcripts, "a.jsonl", a.join("\n"));
	write(transcripts, "b.jsonl", [...a, load("debug", "2026-10-21T10:00:00Z", "toolu_2")].join("\n"));
	for (const [first, second] of [["a.jsonl", "b.jsonl"], ["b.jsonl", "a.jsonl"]]) {
		fs.utimesSync(path.join(transcripts, first), new Date(Date.now() - 3 * 86400000), new Date(Date.now() - 3 * 86400000));
		fs.utimesSync(path.join(transcripts, second), new Date(Date.now() - 2 * 86400000), new Date(Date.now() - 2 * 86400000));
		const r = count({ files: ["a.jsonl", "b.jsonl"].map((n) => path.join(transcripts, n)), known: installedSkills([project]) });
		assert.equal(r.used[0].loads, 2, `${first} changed first`);
	}
});

test("a read is credited to the skills folder nearest the file, whatever the case, and odd lines do not crash it", () => {
	const text = [
		read("/home/me/skills/shop/.claude/skills/api-map/SKILL.md"),
		read("D:\\Work\\skills\\shop\\.claude\\Skills\\feature-map\\SKILL.md"),
		line({ type: "assistant", message: { content: { type: "tool_use", name: "Skill" } } }),
		line({ type: "assistant", message: { content: 42 } }) + ' "Skill"',
		line({ type: "user", message: { content: [null, { type: "text", text: "<command-name>/stack-agent:verify</command-name>" }, { type: "text", text: 5 }] } }),
		line({ type: "assistant", message: { content: [null, { type: "tool_use", name: "Skill", input: { skill: 7 } }] } }),
		"null",
		'{"type":"assistant"',
	].join("\n");
	assert.deepEqual(skillEventsIn(text).map((e) => `${e.kind}:${e.name}`), ["view:api-map", "view:feature-map", "slash:stack-agent:verify"]);
});

test("a skill of the project that nobody used is listed as unused, and the latest use is kept whatever the order in the file", () => {
	const project = tempDir("stack-agent-proj-");
	write(project, ".claude/skills/idle-local/SKILL.md", "---\nname: idle-local\ndescription: Use for idle things.\n---\n");
	const transcripts = tempDir("stack-agent-usage-");
	write(transcripts, "a.jsonl", [load("debug", "2026-10-25T10:00:00Z"), load("debug", "2026-10-20T10:00:00Z")].join("\n"));
	const r = main(["--project", project, "--transcripts", transcripts, "--json", "--min-sessions", "1"]);
	const json = JSON.parse(r.text);
	assert.ok(json.unused.some((x) => x.name === "idle-local"), "the project's own folder is listed");
	assert.equal(json.used.find((x) => x.name === "debug").last, "2026-10-25T10:00:00Z");
});

test("a skill that was only read is not in any session as a use, and the report does not say so", () => {
	const project = skillsFolder("api-map");
	const transcripts = tempDir("stack-agent-usage-");
	write(transcripts, "a.jsonl", [read("D:\\p\\.claude\\skills\\api-map\\SKILL.md", "2026-10-26T10:00:00Z"), read("/home/me/p/.claude/skills/api-map/SKILL.md", "2026-10-26T11:00:00Z")].join("\n"));
	const r = count({ files: [path.join(transcripts, "a.jsonl")], known: installedSkills([project]) });
	const row = r.viewedOnly.find((x) => x.name === "api-map");
	assert.deepEqual({ views: row.views, sessions: row.sessions, loads: row.loads }, { views: 2, sessions: 0, loads: 0 });
	assert.match(report(r), /api-map: loaded 0, slash command 0, read 2, last 2026-10-26/);
	assert.doesNotMatch(report(r), /in 0 session\(s\)/);
});

test("a skill folder that is a link or a junction is listed", () => {
	const target = skillsFolder("real-one");
	const dir = tempDir("stack-agent-skills-");
	try {
		fs.symlinkSync(path.join(target, "real-one"), path.join(dir, "linked-one"), "junction");
	} catch {
		return; // this machine does not allow links; the check cannot be made here
	}
	assert.deepEqual([...installedSkills([dir]).keys()], ["linked-one"]);
});

// Claude Code keeps what a session's subagents did in <session>/subagents/agent-*.jsonl
test("skills a subagent loaded are counted in its session, once, and a session with subagents is still one session", () => {
	const project = skillsFolder("debug", "verify");
	const transcripts = tempDir("stack-agent-usage-");
	write(transcripts, "s1.jsonl", [user("start", "u1"), use("Skill", { skill: "debug" }, "2026-10-20T10:00:00Z", "toolu_main")].join("\n"));
	const sub = (id, ...lines) => write(transcripts, `s1/subagents/agent-${id}.jsonl`, lines.join("\n"));
	sub("a", line({ type: "assistant", isSidechain: true, timestamp: "2026-10-21T10:00:00Z", message: { content: [{ type: "tool_use", id: "toolu_sub", name: "Skill", input: { skill: "stack-agent:verify" } }] } }));
	// the same call repeated in a second subagent file (a resumed agent) and the main call again in a subagent file: counted once
	sub("b", line({ type: "assistant", isSidechain: true, timestamp: "2026-10-21T10:00:00Z", message: { content: [{ type: "tool_use", id: "toolu_sub", name: "Skill", input: { skill: "stack-agent:verify" } }, { type: "tool_use", id: "toolu_main", name: "Skill", input: { skill: "debug" } }] } }));
	write(transcripts, "s1/subagents/notes.txt", "not a transcript");
	const files = [path.join(transcripts, "s1.jsonl")];
	assert.deepEqual(subagentFiles(files[0]).map((f) => path.basename(f)), ["agent-a.jsonl", "agent-b.jsonl"]);
	const r = count({ files, known: installedSkills([project]) });
	assert.equal(r.sessions, 1, "the subagents are not sessions");
	const by = Object.fromEntries([...r.used, ...r.unused].map((x) => [x.name, x]));
	assert.deepEqual({ loads: by.verify.loads, sessions: by.verify.sessions, last: by.verify.last }, { loads: 1, sessions: 1, last: "2026-10-21T10:00:00Z" });
	assert.equal(by.debug.loads, 1);
	assert.deepEqual(subagentFiles(path.join(transcripts, "nothing.jsonl")), []);
});
