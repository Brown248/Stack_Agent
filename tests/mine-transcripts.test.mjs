import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { correctionsIn, main, mine, projectSlug, transcriptDirs, userText } from "../scripts/mine-transcripts.mjs";
import { tempDir, write } from "./helpers.mjs";

const line = (o) => JSON.stringify(o);
const user = (text, extra = {}) => line({ type: "user", sessionId: "s1", timestamp: extra.at ?? "2026-10-20T10:00:00Z", message: { role: "user", content: [{ type: "text", text }] }, ...extra });
const agent = (text, extra = {}) => line({ type: "assistant", message: { content: [{ type: "text", text }] }, ...extra });
const toolResult = line({ type: "user", message: { content: [{ type: "tool_result", content: "no, not found" }] } });

const SESSION = [
	user("Add DELETE /items/:id."),
	agent("Done: I put the query in the controller."),
	toolResult,
	user("<system-reminder>ignore me</system-reminder>No, SQL goes in repository.js, every time.", { at: "2026-10-20T10:05:00Z" }),
	agent("Moved it."),
	user("thanks, looks good"),
	agent("Anything else?"),
	user("[Request interrupted by user]"),
	agent("Stopped."),
	user("you forgot the test again", { isSidechain: true }),
	user("<command-name>/clear</command-name>"),
	agent("ok"),
	user("Why did you run git reset? Never do that.", { isMeta: true }),
	agent("Sorry."),
	user("ห้ามแก้ migration ที่ใช้ไปแล้ว", { at: "2026-10-20T11:00:00Z" }),
].join("\n");

test("projectSlug names the folder the way Claude Code does: every non-alphanumeric character becomes -", () => {
	const dir = tempDir("stack-agent_mine.x-");
	assert.equal(projectSlug(dir), path.resolve(dir).replace(/[^A-Za-z0-9]/g, "-"));
	assert.doesNotMatch(projectSlug(dir), /[^A-Za-z0-9-]/);
});

test("userText keeps what the user typed and drops tool results, injected blocks, sidechains, and meta turns", () => {
	const events = SESSION.split("\n").map((l) => JSON.parse(l));
	assert.equal(userText(events[3]), "No, SQL goes in repository.js, every time.");
	assert.equal(userText(events[2]), null, "tool result");
	assert.equal(userText(events[7]), null, "interrupt note");
	assert.equal(userText(events[9]), null, "sidechain");
	assert.equal(userText(events[10]), null, "slash-command echo");
	assert.equal(userText(events[12]), null, "meta");
	assert.equal(userText(JSON.parse(line({ type: "user", message: { content: "plain string content" } }))), "plain string content");
});

test("correctionsIn lists what the user wrote after an agent reply that reads like a correction, with the reply before it", () => {
	const found = correctionsIn(SESSION, { session: "s1" });
	assert.deepEqual(found.map((f) => f.text), ["No, SQL goes in repository.js, every time.", "ห้ามแก้ migration ที่ใช้ไปแล้ว"]);
	assert.equal(found[0].after, "Done: I put the query in the controller.");
	assert.equal(found[0].session, "s1");
	assert.equal(found[0].at, "2026-10-20T10:05:00Z");
	// the opening request is the task, and --all includes plain follow-ups
	const all = correctionsIn(SESSION, { all: true }).map((f) => f.text);
	assert.ok(all.includes("thanks, looks good"));
	assert.ok(!all.includes("Add DELETE /items/:id."));
});

test("transcriptDirs finds the project's folder, and its worktrees' folders on request", () => {
	const base = tempDir("stack-agent-projects-");
	const project = tempDir("stack-agent-proj-");
	const slug = projectSlug(project);
	for (const name of [slug, `${slug}--claude-worktrees-feature-x`, `${slug}-other`]) fs.mkdirSync(path.join(base, name));
	assert.deepEqual(transcriptDirs(project, { base }).map((d) => path.basename(d)), [slug]);
	assert.deepEqual(transcriptDirs(project, { base, worktrees: true }).map((d) => path.basename(d)).sort(), [slug, `${slug}--claude-worktrees-feature-x`].sort());
	assert.deepEqual(transcriptDirs(project, { base: path.join(base, "missing") }), []);
});

test("mine reads only sessions changed within --days, and sorts what it found by time", () => {
	const dir = tempDir("stack-agent-transcripts-");
	write(dir, "recent.jsonl", SESSION);
	write(dir, "old.jsonl", [user("start"), agent("done"), user("No, wrong file again.")].join("\n"));
	const old = new Date(Date.now() - 60 * 86400000);
	fs.utimesSync(path.join(dir, "old.jsonl"), old, old);
	write(dir, "notes.txt", "not a transcript");
	const r = mine({ dirs: [dir], days: 30 });
	assert.equal(r.sessions, 1);
	assert.deepEqual(r.found.map((f) => f.session), ["recent", "recent"]);
	assert.equal(mine({ dirs: [dir], days: 90 }).sessions, 2);
});

test("the command prints a summary or JSON, and says where it looked when there are no transcripts", () => {
	const dir = tempDir("stack-agent-transcripts-");
	write(dir, "a.jsonl", SESSION);
	const text = main(["--transcripts", dir]).text;
	assert.match(text, /^2 message\(s\) after an agent reply in 1 session\(s\) from the last 30 day\(s\)/);
	assert.match(text, /- \[a [\d-]+\] No, SQL goes in repository\.js, every time\./);
	const json = JSON.parse(main(["--transcripts", dir, "--json", "--all"]).text);
	assert.equal(json.count, 3);
	assert.throws(() => main(["--project", tempDir("stack-agent-none-"), "--days", "1"]), /no Claude Code transcripts for/);
	assert.throws(() => main(["--transcripts", dir, "--days", "0"]), /--days must be a positive number/);
});

// a resumed session starts with a copy of the one it continues (on one real project 4,422 of 6,942 user events were
// repeats), which made one correction look like it came from two sessions, the bar for a class
test("a correction in a resumed session's copy of the history is listed once, from the session it was typed in", () => {
	const dir = tempDir("stack-agent-transcripts-");
	const at = (n) => `2026-10-2${n}T10:00:00Z`;
	const first = [user("start", { uuid: "u1" }), agent("done"), user("No, SQL goes in repository.js.", { uuid: "u2", at: at(1) })];
	write(dir, "original.jsonl", first.join("\n"));
	write(dir, "resumed.jsonl", [...first, agent("fixed"), user("Never use SELECT * either.", { uuid: "u3", at: at(2) })].join("\n"));
	write(dir, "pure-copy.jsonl", first.join("\n"));
	const t = (n) => new Date(Date.now() - n * 86400000);
	for (const [name, days] of [["original.jsonl", 5], ["pure-copy.jsonl", 4], ["resumed.jsonl", 3]]) fs.utimesSync(path.join(dir, name), t(days), t(days));
	const r = mine({ dirs: [dir], days: 30 });
	assert.equal(r.sessions, 2, "the pure copy is not a session");
	assert.deepEqual(r.found.map((f) => [f.session, f.text]), [["original", "No, SQL goes in repository.js."], ["resumed", "Never use SELECT * either."]]);
});

test("odd lines in a transcript are skipped, not crashed on", () => {
	const lines = [
		"null",
		"42",
		'"just a string"',
		line({ type: "user", message: { content: [null, { type: "text", text: 5 }, { type: "text", text: "No, wrong file again." }] } }),
		line({ type: "assistant", message: { content: "plain string content" } }),
		line({ type: "assistant", message: { content: [null, { type: "text", text: 7 }, { type: "text", text: "Done: I put it in the controller." }] } }),
		line({ type: "user", message: { content: [null, { type: "tool_result" }] } }),
		user("No, SQL goes in repository.js."),
		"{not json",
	];
	assert.equal(userText(JSON.parse(lines[3])), "No, wrong file again.");
	assert.equal(userText(JSON.parse(lines[0])), null);
	// the first user message is the task; the correction after the agent's reply is found
	const found = correctionsIn([user("start"), ...lines].join("\n"), { all: true });
	assert.deepEqual(found.map((f) => f.text), ["No, SQL goes in repository.js."]);
	assert.equal(found[0].after, "Done: I put it in the controller.");
});
