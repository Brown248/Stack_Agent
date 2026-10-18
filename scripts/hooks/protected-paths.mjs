export const PROTECTED = [
	{ re: /(^|[\\/])\.stack-agent[\\/]guard\.config\.json$/, what: "the guard rules" },
	{ re: /(^|[\\/])\.stack-agent[\\/]guard-baseline\.json$/, what: "the guard baseline" },
	{ re: /(^|[\\/])\.stack-agent[\\/]bin[\\/]/, what: "the vendored Stack Agent tools" },
	{ re: /(^|[\\/])\.github[\\/]workflows[\\/]stack-agent\.ya?ml$/, what: "the Stack Agent CI workflow" },
];

export function protectedWhat(filePath) {
	return PROTECTED.find((p) => p.re.test(String(filePath ?? "")))?.what ?? null;
}

export function protectedMentioned(text) {
	return PROTECTED.find((p) => new RegExp(p.re.source.replace(/\$$/, "").replace("(^|[\\\\/])", "")).test(String(text ?? "")))?.what ?? null;
}

export function askForProtected(what) {
	return {
		decision: "ask",
		reason: `this changes ${what}, which decide what the guard enforces. Loosening them is how a rule gets bypassed, so a human must approve it. To fix a violation, change the code instead.`,
	};
}
