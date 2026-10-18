#!/usr/bin/env node
import { askForProtected, protectedWhat } from "./protected-paths.mjs";
import { readHookInput } from "./read-input.mjs";

const input = readHookInput();
const what = protectedWhat(input.tool_input?.file_path);
if (what) {
	const { decision, reason } = askForProtected(what);
	process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }));
}
