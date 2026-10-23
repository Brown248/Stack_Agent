import path from "node:path";

export const PROTECTED = [
	{ re: /(^|[\\/])\.stack-agent[\\/]guard\.config\.json$/, what: "the guard rules" },
	{ re: /(^|[\\/])\.stack-agent[\\/]guard-baseline\.json$/, what: "the guard baseline" },
	{ re: /(^|[\\/])\.stack-agent[\\/]bin[\\/]/, what: "the vendored Stack Agent tools" },
	// stack-agent-<folder>.yml is the workflow init writes for a project in a subfolder of a monorepo
	{ re: /(^|[\\/])\.github[\\/]workflows[\\/]stack-agent(-[\w.-]+)?\.ya?ml$/, what: "the Stack Agent CI workflow" },
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
	// the folder named on its own or its latest.json, ending where the path ends
	const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const rels = [...new Set(dirs.filter((d) => typeof d === "string" && d))].map((d) => new RegExp(`(?<![\\w.-])${escape(norm(path.posix.normalize(d.replaceAll("\\", "/")).replace(/\/$/, "")))}(?:/latest\\.json)?(?![\\w.\\\\/-])`));
	const guard = (filePath) => {
		if (!filePath) return null;
		const abs = norm(path.resolve(cwd, fromMsys(String(filePath).replace(/^["']|["']$/g, ""))));
		return wanted.has(abs) ? "the verify evidence" : null;
	};
	// for inline scripts (node -e "..."), where the path sits inside a string
	guard.mentions = (text) => (mentionForms(text).some((t) => rels.some((r) => r.test(norm(t)))) ? "the verify evidence" : null);
	return guard;
}

export function protectedWhat(filePath) {
	return PROTECTED.find((p) => p.re.test(String(filePath ?? "")))?.what ?? null;
}

// For inline scripts (node -e "..."), where a path sits inside a string. A pattern that ends at the end of a path
// must end at the end of the path here too: ".stack-agent" or ".stack-agent/evidence" followed by a quote or a space
// names the protected folder, but ".stack-agent/verify.json" names a file inside it that is not protected.
// A folder pattern (one ending in a separator) also matches the folder named on its own: ".stack-agent/bin".
// Separators are collapsed first and "./" and "x/../" resolved, so ".stack-agent\\evidence" or
// ".stack-agent/evidence/../guard-baseline.json" name what they really name.
const MENTION_RES = PROTECTED.map((p) => ({
	what: p.what,
	re: new RegExp(p.re.source.replace(/\$$/, "(?![\\w.\\\\/-])").replace(/\[\\\\\/\]$/, "(?:[\\\\/]|(?![\\w.-]))").replace("(^|[\\\\/])", "")),
}));
// The text as written and with path-join arguments joined: path.join('.github', 'workflows', 'x.yml') and
// os.path.join(".stack-agent", "evidence") name the same paths as the joined string. Both forms are tested, so
// joining can only add matches.
export function mentionForms(text) {
	let t = String(text ?? "").replace(/[\\/]+/g, "/").replace(/(^|\/)(\.\/)+/g, "$1");
	for (let prev; prev !== t; ) [prev, t] = [t, t.replace(/(?!\.\.\/)[^/\s"'`]+\/\.\.\//, "")];
	const joined = t.replace(/["'`]\s*,\s*["'`]/g, "/");
	return joined === t ? [t] : [t, joined];
}

// Deleting the folder that holds the CI workflow removes the one gate that holds when the hooks do not. Only a
// delete asks: adding, copying, or listing workflows is ordinary work.
export const WORKFLOWS_FOLDER = /(^|[\\/])\.github([\\/]workflows)?[\\/]?$/;
const WORKFLOWS_MENTION = /(?<![\w.-])\.github(\/workflows)?\/?(?![\w.\\/-])/;
export function workflowsFolderMentioned(text) {
	return mentionForms(text).some((t) => WORKFLOWS_MENTION.test(t));
}

export function protectedMentioned(text) {
	const forms = mentionForms(text);
	return MENTION_RES.find((p) => forms.some((t) => p.re.test(t)))?.what ?? null;
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
