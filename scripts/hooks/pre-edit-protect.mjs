#!/usr/bin/env node
import path from "node:path";
import { renderVerdict } from "../lib/messages.mjs";
import { FILLED_IN_AT_SETUP, askForProtected, isUncommittedTemplate, protectedWhat } from "./protected-paths.mjs";
import { dirOf, projectContext } from "./project-context.mjs";
import { readHookInput } from "./read-input.mjs";

const input = readHookInput();
const filePath = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
const ctx = projectContext(input, dirOf(filePath, input.cwd));
const named = protectedWhat(filePath);
const template = named && FILLED_IN_AT_SETUP.has(named) && isUncommittedTemplate(path.resolve(input.cwd ?? process.cwd(), filePath));
const what = template ? null : (named ?? ctx.guard(filePath));
if (what) {
	const verdict = askForProtected(what);
	process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: verdict.decision, permissionDecisionReason: renderVerdict(verdict, ctx.lang) } }));
}
ctx.record();
