import path from "node:path";

export const PROTECTED = [
	{ re: /(^|[\\/])\.stack-agent[\\/]guard\.config\.json$/, what: "the guard rules" },
	{ re: /(^|[\\/])\.stack-agent[\\/]guard-baseline\.json$/, what: "the guard baseline" },
	{ re: /(^|[\\/])\.stack-agent[\\/]bin[\\/]/, what: "the vendored Stack Agent tools" },
	{ re: /(^|[\\/])\.github[\\/]workflows[\\/]stack-agent\.ya?ml$/, what: "the Stack Agent CI workflow" },
	{ re: /(^|[\\/])\.stack-agent[\\/]evidence[\\/]latest\.json$/, what: "the verify evidence", evidence: true },
	{ re: /(^|[\\/])\.stack-agent[\\/]verify-skip\.json$/, what: "the verify skip record", evidence: true },
	{ re: /(^|[\\/])\.stack-agent[\\/]evidence[\\/]sessions([\\/][^\\/]*)?[\\/]?$/, what: "the Stop hook's session record", evidence: true },
	{ re: /(^|[\\/])\.stack-agent([\\/]evidence)?[\\/]?$/, what: "the Stack Agent folder and its evidence", evidence: true },
];

// E4: a custom evidenceDir is protected too. Both the session snapshot and the live verify.json are read; using
// both only ever adds protection, so editing verify.json cannot remove it.
export function evidenceGuard(root, cwd, dirs) {
	const targets = [...new Set(dirs.filter((d) => typeof d === "string" && d))].map((d) => path.resolve(root, d, "latest.json"));
	if (!targets.length) return Object.assign(() => null, { mentions: () => null });
	const win = process.platform === "win32";
	const norm = (p) => (win ? p.toLowerCase() : p);
	// Git Bash and MSYS write D:\x as /d/x
	const fromMsys = (p) => (win && /^\/[a-z]\//i.test(p) ? `${p[1]}:${p.slice(2)}` : p);
	const wanted = new Set(targets.map(norm));
	const rels = [...new Set(dirs.filter((d) => typeof d === "string" && d))].map((d) => norm(path.posix.join(d.replaceAll("\\", "/"), "latest.json")));
	const guard = (filePath) => {
		if (!filePath) return null;
		const abs = norm(path.resolve(cwd, fromMsys(String(filePath).replace(/^["']|["']$/g, ""))));
		return wanted.has(abs) ? "the verify evidence" : null;
	};
	// for inline scripts (node -e "..."), where the path sits inside a string
	guard.mentions = (text) => (rels.some((r) => norm(String(text ?? "").replaceAll("\\", "/")).includes(r)) ? "the verify evidence" : null);
	return guard;
}

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
