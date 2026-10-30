#!/usr/bin/env node
// A PreToolUse hook for routing-live.mjs that refuses every tool. A live routing session is stopped at its first tool
// call, but the stop is sent after the call has started; with this hook the call is refused before it runs, so a
// session cannot read, search, or change anything, whatever the model asks for. The tool stays in the model's list, so
// what it chooses first is what it would choose in a real session. It answers with the decision and also with exit code 2
// and the reason on stderr, which Claude Code treats as a block, so a hook that cannot print its answer still refuses.
process.stdin.resume();
process.stdin.on("data", () => {});
process.stdin.on("end", () => {
	const reason = "routing check: no tool runs in this session";
	console.error(reason);
	console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
	process.exitCode = 2;
});
