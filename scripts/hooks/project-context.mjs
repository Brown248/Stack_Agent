// Shared by the PreToolUse hooks: find the Stack Agent project, build the extra evidence protection for a custom
// evidenceDir (E4), and offer record() to take the session baseline before the first change (E3). Callers print
// their verdict first and call record() after, so slow git work on a big repo can never delay or drop a verdict.
// Never throws: a hook must not fail or deny because this bookkeeping could not run.
import path from "node:path";
import { VERIFY_CONFIG } from "../lib/fingerprint.mjs";
import { evidenceGuard } from "./protected-paths.mjs";
import { findUp } from "./read-input.mjs";
import { ensureSessionRecord, readConfig, readStart } from "./session-record.mjs";

const none = Object.assign(() => null, { mentions: () => null });

export function projectContext(input, startDir) {
	const cwd = input.cwd ?? process.cwd();
	try {
		const root = findUp(startDir ?? cwd, VERIFY_CONFIG) ?? (startDir ? findUp(cwd, VERIFY_CONFIG) : null);
		if (!root) return { guard: none, record: () => null };
		const start = readStart(root, input.session_id);
		const guard = evidenceGuard(root, cwd, [start?.evidenceDir, readConfig(root).evidenceDir]);
		const record = () => {
			try {
				return ensureSessionRecord(root, input.session_id);
			} catch {
				return null;
			}
		};
		return { root, guard, record };
	} catch {
		return { guard: none, record: () => null };
	}
}

export const dirOf = (filePath, cwd) => (filePath ? path.dirname(path.resolve(cwd ?? process.cwd(), String(filePath))) : undefined);
