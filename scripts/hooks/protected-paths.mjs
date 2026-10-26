import { spawnSync } from "node:child_process";
import fs from "node:fs";
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

// The shared guard files a project's guard config extends: editing one loosens the guard like editing the config.
// Paths are matched exactly; inside an inline script, a file's name on its own counts (conservative: it may ask
// for a script that only reads it).
export function sharedRulesGuard(cwd, files) {
	const win = process.platform === "win32";
	const norm = (p) => (win ? p.toLowerCase() : p);
	const fromMsys = (p) => (win && /^\/[a-z]\//i.test(p) ? `${p[1]}:${p.slice(2)}` : p);
	const wanted = new Set(files.map((f) => norm(path.resolve(f))));
	if (!wanted.size) return Object.assign(() => null, { mentions: () => null });
	const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const names = [...new Set(files.map((f) => path.basename(f)))].map((n) => new RegExp(`(?<![\\w.-])${escape(norm(n))}(?![\\w.-])`));
	const what = "the shared guard rules (a file guard.config.json extends)";
	const guard = (filePath) => {
		if (!filePath) return null;
		const abs = norm(path.resolve(cwd, fromMsys(String(filePath).replace(/^["']|["']$/g, ""))));
		return wanted.has(abs) ? what : null;
	};
	guard.mentions = (text) => (names.some((r) => r.test(norm(String(text ?? "")))) ? what : null);
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

// A guard config or CI workflow that init wrote and nobody has filled in or committed: it still has EDIT ME
// placeholders and git has never seen it (not in the index, not in HEAD). It holds no rule yet that an edit could
// loosen, and the setup skill has to fill it in, so Edit and Write on it do not ask. Once the placeholders are gone
// or the file is committed, edits ask again; what it says when first committed is reviewed like any other change.
export const FILLED_IN_AT_SETUP = new Set(["the guard rules", "the Stack Agent CI workflow"]);

export function isUncommittedTemplate(abs) {
	let text;
	try {
		text = fs.readFileSync(abs, "utf8");
	} catch {
		// a file Write would create is not a template init wrote
		return false;
	}
	if (!text.includes("EDIT ME")) return false;
	const dir = path.dirname(abs);
	const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
	// outside git nothing tells a fresh template from a config someone relies on, so it stays protected
	if (git("rev-parse", "--is-inside-work-tree").status !== 0) return false;
	const name = path.basename(abs);
	if (git("ls-files", "--error-unmatch", "--", name).status === 0) return false;
	// unstaged with git rm --cached, but still in the last commit
	return git("cat-file", "-e", `HEAD:./${name}`).status !== 0;
}

export function askForProtected(what) {
	if (PROTECTED.find((p) => p.what === what)?.evidence)
		return {
			decision: "ask",
			reason: `this writes ${what} by hand. Only verify.mjs writes it (run it, or use verify.mjs --skip "<reason>"), so a hand-written one would claim a verification that did not happen; a human must approve it.`,
		};
	// a shell write to a template is asked about too; the setup skill can fill it in with Edit or Write instead
	const setup = FILLED_IN_AT_SETUP.has(what) ? " If you are filling in the template init just wrote (it still has EDIT ME and is not committed), use the Edit or Write tool instead: those do not ask for it." : "";
	return {
		decision: "ask",
		reason: `this changes ${what}. That controls what the guard enforces, and loosening it is how a rule gets bypassed, so a human must approve it. To fix a violation, change the code instead.${setup}`,
	};
}
