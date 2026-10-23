#!/usr/bin/env node
// Records what the code and the Stop hook's settings looked like when the session began (see session-record.mjs),
// so the Stop hook only holds the agent to changes made in this session and verify's against step can compare
// with the code before the session's work, even if the agent commits along the way.
// It also tells the human when the project's vendored tools differ from this plugin's copy (see tools-check.mjs).
import { VERIFY_CONFIG } from "../lib/fingerprint.mjs";
import { findUp, readHookInput } from "./read-input.mjs";
import { ensureSessionRecord } from "./session-record.mjs";
import { toolsMessage } from "./tools-check.mjs";

const input = readHookInput();
const root = findUp(input.cwd ?? process.cwd(), VERIFY_CONFIG);
// a resumed or compacted session keeps its first record, or changes made before compaction would be forgotten
if (root) {
	ensureSessionRecord(root, input.session_id);
	const message = toolsMessage(root);
	if (message) process.stdout.write(JSON.stringify({ systemMessage: message }));
}
