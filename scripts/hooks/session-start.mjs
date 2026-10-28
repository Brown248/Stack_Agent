#!/usr/bin/env node
// Records what the code and the Stop hook's settings looked like when the session began (see session-record.mjs),
// so the Stop hook only holds the agent to changes made in this session and verify's against step can compare
// with the code before the session's work, even if the agent commits along the way.
// It also tells the human when the project's vendored tools differ from this plugin's copy (see tools-check.mjs), and,
// when the language is Thai (see lib/messages.mjs), tells the agent so, in plain words, as context.
import { VERIFY_CONFIG } from "../lib/fingerprint.mjs";
import { agentLanguageNote, languageFor } from "../lib/messages.mjs";
import { findUp, readHookInput } from "./read-input.mjs";
import { ensureSessionRecord, readConfig } from "./session-record.mjs";
import { toolsMessage } from "./tools-check.mjs";

const input = readHookInput();
const root = findUp(input.cwd ?? process.cwd(), VERIFY_CONFIG);
// a resumed or compacted session keeps its first record, or changes made before compaction would be forgotten
if (root) {
	ensureSessionRecord(root, input.session_id);
	const lang = languageFor(readConfig(root));
	const message = toolsMessage(root, lang);
	const note = agentLanguageNote(lang);
	const output = {};
	if (message) output.systemMessage = message;
	if (note) output.hookSpecificOutput = { hookEventName: "SessionStart", additionalContext: note };
	if (message || note) process.stdout.write(JSON.stringify(output));
}
