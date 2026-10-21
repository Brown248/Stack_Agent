#!/usr/bin/env node
import { askForProtected, protectedWhat } from "./protected-paths.mjs";
import { dirOf, projectContext } from "./project-context.mjs";
import { readHookInput } from "./read-input.mjs";

const input = readHookInput();
const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
const ctx = projectContext(input, dirOf(filePath, input.cwd));
const what = protectedWhat(filePath) ?? ctx.guard(filePath);
if (what) {
	const { decision, reason } = askForProtected(what);
	process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason } }));
}
ctx.record();
