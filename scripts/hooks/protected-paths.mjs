export const PROTECTED = [
	{ re: /(^|[\\/])\.stack-agent[\\/]guard\.config\.json$/, what: "the guard rules" },
	{ re: /(^|[\\/])\.stack-agent[\\/]guard-baseline\.json$/, what: "the guard baseline" },
	{ re: /(^|[\\/])\.stack-agent[\\/]bin[\\/]/, what: "the vendored Stack Agent tools" },
	{ re: /(^|[\\/])\.github[\\/]workflows[\\/]stack-agent\.ya?ml$/, what: "the Stack Agent CI workflow" },
	{ re: /(^|[\\/])\.stack-agent[\\/]evidence[\\/]latest\.json$/, what: "the verify evidence", evidence: true },
	{ re: /(^|[\\/])\.stack-agent[\\/]verify-skip\.json$/, what: "the verify skip record", evidence: true },
	{ re: /(^|[\\/])\.stack-agent[\\/]evidence[\\/]sessions([\\/][^\\/]*)?$/, what: "the Stop hook's session record", evidence: true },
	{ re: /(^|[\\/])\.stack-agent([\\/]evidence)?[\\/]?$/, what: "the Stack Agent folder and its evidence", evidence: true },
];

export function protectedWhat(filePath) {
	return PROTECTED.find((p) => p.re.test(String(filePath ?? "")))?.what ?? null;
}

export function protectedMentioned(text) {
	return PROTECTED.find((p) => new RegExp(p.re.source.replace(/\$$/, "").replace("(^|[\\\\/])", "")).test(String(text ?? "")))?.what ?? null;
}

export function askForProtected(what) {
	if (PROTECTED.find((p) => p.what === what)?.evidence)
		return {
			decision: "ask",
			reason: `this writes ${what} by hand. Only verify.mjs writes it (run it, or use verify.mjs --skip "<reason>"), so a hand-written one would claim a verification that did not happen; a human must approve it.`,
		};
	return {
		decision: "ask",
		reason: `this changes ${what}. That controls what the guard enforces, and loosening it is how a rule gets bypassed, so a human must approve it. To fix a violation, change the code instead.`,
	};
}
