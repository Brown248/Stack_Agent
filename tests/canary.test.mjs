// The canary checks that the plugin still loads and its hooks still fire under the Claude Code that is current now,
// which the tests cannot say (they run the hook scripts with made-up input). A fake claude stands in, so npm test
// needs no credentials and costs nothing.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { liveChecks, main, staticChecks } from "../scripts/canary.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { repoRoot, tempDir } from "./helpers.mjs";

const DENY = "blocked: `git commit --no-verify` skips the repo's guard and checks. Fix what the hook reports instead.";

// A fake claude. --version prints a version; `plugin validate` exits as VALIDATE says; a headless run writes the
// stream-json the real one writes, shaped by MODE: "deny" (the hook fires and the commit does not happen), "silent"
// (no hook, the commit goes through), "login" (no credentials).
function fakeClaude(mode, { validate = 0, version = "9.9.9 (Claude Code)" } = {}) {
	const dir = tempDir("stack-agent-canary-");
	const file = path.join(dir, "claude.mjs");
	fs.writeFileSync(
		file,
		`import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(dir, "calls.log"))}, JSON.stringify(args) + "\\n");
if (args[0] === "--version") { console.log(${JSON.stringify(version)}); process.exit(0); }
if (args[0] === "plugin" && args[1] === "validate") { console.log(${validate} ? "✘ Validation failed: hooks.json is not valid" : "✔ Validation passed"); process.exit(${validate}); }
const out = (o) => console.log(JSON.stringify(o));
if (${JSON.stringify(mode)} === "login") { out({ type: "result", is_error: true, result: "Not logged in · Please run /login" }); process.exit(1); }
const sessions = path.join(process.cwd(), ".stack-agent", "evidence", "sessions");
if (${JSON.stringify(mode)} !== "nohook") { fs.mkdirSync(sessions, { recursive: true }); fs.writeFileSync(path.join(sessions, "fake.start.json"), "{}"); }
out({ type: "system", subtype: "init", cwd: process.cwd(), plugins: [{ name: "stack-agent", source: "stack-agent@inline" }] });
out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git commit --allow-empty --no-verify -m canary" } }] } });
if (${JSON.stringify(mode)} === "deny" || ${JSON.stringify(mode)} === "nohook") {
  out({ type: "system", subtype: "hook_response", hook_name: "PreToolUse:Bash", command: "node scripts/hooks/pre-bash.mjs" });
  out({ type: "user", message: { content: [{ type: "tool_result", is_error: true, content: ${JSON.stringify(DENY)} }] } });
} else {
  spawnSync("git", ["-c", "user.name=c", "-c", "user.email=c@c", "commit", "--allow-empty", "--no-verify", "-qm", "canary"], { cwd: process.cwd() });
  out({ type: "user", message: { content: [{ type: "tool_result", content: "[main abc1234] canary" }] } });
}
out({ type: "result", is_error: false, result: "done", total_cost_usd: 0.01, num_turns: 2 });
`,
	);
	return { file, env: { ...process.env, CLAUDE_BIN: file }, calls: () => fs.readFileSync(path.join(dir, "calls.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) };
}

test("the static check reports the version and passes when plugin validate passes", () => {
	const claude = fakeClaude("deny");
	const r = staticChecks({ root: repoRoot, env: claude.env });
	assert.equal(r.ok, true);
	assert.equal(r.version, "9.9.9 (Claude Code)");
	assert.deepEqual(claude.calls().at(-1).slice(0, 4), ["plugin", "validate", repoRoot, "--strict"]);
});

test("the static check fails when plugin validate fails, and says what it printed", () => {
	const r = staticChecks({ root: repoRoot, env: fakeClaude("deny", { validate: 1 }).env });
	assert.equal(r.ok, false);
	assert.match(r.detail, /hooks\.json is not valid/);
});

test("the live check passes when the hook denies --no-verify, the session was recorded, and no commit was made", () => {
	const claude = fakeClaude("deny");
	const r = liveChecks({ root: repoRoot, env: claude.env, model: "haiku", budget: 0.3 });
	assert.equal(r.ok, true, r.detail);
	const run = claude.calls().find((a) => a.includes("-p"));
	assert.ok(run.includes("--plugin-dir") && run.includes(repoRoot), "loads the plugin from the repo");
	assert.equal(run[run.indexOf("--model") + 1], "haiku");
	assert.equal(run[run.indexOf("--max-budget-usd") + 1], "0.3");
});

test("the live check fails when the commit goes through, because no hook stopped it", () => {
	const r = liveChecks({ root: repoRoot, env: fakeClaude("silent").env, model: "haiku", budget: 0.3 });
	assert.equal(r.ok, false);
	assert.match(r.detail, /the --no-verify commit was not denied|a commit was made/);
});

test("the live check fails when the session start was not recorded", () => {
	const r = liveChecks({ root: repoRoot, env: fakeClaude("nohook").env, model: "haiku", budget: 0.3 });
	assert.equal(r.ok, false);
	assert.match(r.detail, /SessionStart/);
});

test("with no credentials the live check is skipped, not failed", () => {
	const r = liveChecks({ root: repoRoot, env: fakeClaude("login").env, model: "haiku", budget: 0.3 });
	assert.equal(r.skipped, true);
	assert.match(r.detail, /Not logged in/);
});

test("main: exit 0 when the static check passes, 1 when a check fails, 2 when claude cannot be found", () => {
	assert.equal(main([], fakeClaude("deny").env).code, 0);
	assert.equal(main(["--live"], fakeClaude("deny").env).code, 0);
	assert.equal(main(["--live"], fakeClaude("silent").env).code, 1);
	assert.equal(main([], fakeClaude("deny", { validate: 1 }).env).code, 1);
	assert.equal(main(["--live"], fakeClaude("login").env).code, 0, "a skipped live check does not fail the run");
	assert.throws(() => main([], { ...process.env, CLAUDE_BIN: path.join(tempDir(), "nope.mjs") }), ConfigError);
	assert.match(main(["--json"], fakeClaude("deny").env).text, /"version": "9\.9\.9/);
});

test("the workflow runs weekly and on demand, needs no secret for the static check, and runs the live one only with a key", () => {
	const text = fs.readFileSync(path.join(repoRoot, ".github/workflows/claude-code-canary.yml"), "utf8").replace(/\r\n/g, "\n");
	assert.match(text, /^ {2}schedule:\n {4}- cron: "\d+ \d+ \* \* \d"/m, "weekly");
	assert.match(text, /^ {2}workflow_dispatch:/m, "on demand");
	assert.match(text, /npm install --global @anthropic-ai\/claude-code\b/, "the latest Claude Code, not a pinned one");
	assert.match(text, /^permissions:\n {2}contents: read$/m, "read-only token");
	const live = text.split("- name: ").find((s) => s.includes("canary.mjs --live"));
	assert.ok(live, "has a live step");
	assert.match(live, /if: env\.ANTHROPIC_API_KEY != ''/, "only with a key");
	const stat = text.split("- name: ").find((s) => /run: node scripts\/canary\.mjs\n/.test(s));
	assert.ok(stat && !/if:/.test(stat), "the static step always runs");
	assert.doesNotMatch(text, /secrets\.(?!ANTHROPIC_API_KEY)/, "no other secret");
});
