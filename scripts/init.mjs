#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./guard.mjs";
import { ConfigError, parseArgs, realPath, toPosix } from "./lib/files.mjs";

const USAGE = `usage: node init.mjs [TARGET_DIR] [--preset NAME] [--shared-rules FILE] [--check] [--list-presets]
  copies the Stack Agent tools into TARGET_DIR/.stack-agent/bin (refreshed on every run),
  adds config templates for the chosen preset and a CI workflow only where none exist,
  and ignores the evidence dir.
  --preset NAME   project type: generic (default), backend-http, cli, library, frontend-web
  --check         only report setup that is still unfinished (EDIT ME placeholders, missing files,
                  vendored tools in .stack-agent/bin that differ from this plugin's copy), and note any rule
                  every preset ships that the guard config lacks (a note only; "declinedRules" silences it)
  --shared-rules FILE  copy a team's guard rules file (a JSON file with a rules array) to
                  .stack-agent/shared-rules.json and remember where it came from; every later init refreshes the
                  copy, and --check reports one that differs from its source
  --list-presets  print the available presets
exit codes: 0 done (with --check: setup complete), 1 --check found unfinished setup, 2 usage error.
  Without --check, init exits 0 after writing the files even while setup is unfinished; it lists what is left.`;

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const TOOLS = ["guard.mjs", "verify.mjs", "api-map.mjs", "feature-map.mjs", "lib/files.mjs", "lib/fingerprint.mjs"];
const PRESETS_DIR = path.join(pluginRoot, "templates", "presets");
const COMMON = [
	["templates/common/rules.md", ".stack-agent/rules.md"],
	["templates/common/rules-table.md", ".stack-agent/rules-table.md"],
];
const WORKFLOW_TEMPLATE = "templates/ci/stack-agent.yml";
const FEATURE_MAP_TEMPLATE = "templates/common/feature-map.md";
const FEATURE_MAP = ".stack-agent/feature-map.md";
const ROOT_WORKFLOW = ".github/workflows/stack-agent.yml";
const ALWAYS_REQUIRED = [".stack-agent/guard.config.json", ".stack-agent/verify.json", ...COMMON.map(([, dest]) => dest)];
const GITIGNORE_LINE = ".stack-agent/evidence/";
const PRESET_FILES = ["guard.config.json", "verify.json", "api-map.json"];
const PRESET_MARKER = ".stack-agent/preset";
const BIN = ".stack-agent/bin";

export function pluginVersion() {
	return JSON.parse(fs.readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8")).version;
}

// Everything init writes to .stack-agent/bin: each tool as this plugin ships it, plus a VERSION stamp for humans.
export function vendoredFiles() {
	return [...TOOLS.map((tool) => [tool, fs.readFileSync(path.join(pluginRoot, "scripts", tool))]), ["VERSION", Buffer.from(pluginVersion() + "\n")]];
}

// Git for Windows defaults to core.autocrlf=true, so a clone checks the tools out with CRLF line endings although the
// repository holds them with LF; that is the same tool, not an outdated one. (init also writes .stack-agent/.gitattributes
// so new checkouts keep LF.)
const sameTool = (a, b) => Buffer.compare(a, b) === 0 || a.toString("utf8").replace(/\r\n/g, "\n") === b.toString("utf8").replace(/\r\n/g, "\n");

export function outdatedTools(target) {
	return vendoredFiles()
		.filter(([rel, src]) => {
			const dest = path.join(target, BIN, rel);
			return !fs.existsSync(dest) || !sameTool(fs.readFileSync(dest), src);
		})
		.map(([rel]) => rel);
}

const STACK_AGENT_ATTRIBUTES = ".stack-agent/.gitattributes";
const ATTRIBUTES_TEXT = "# Stack Agent: keep LF on every OS, so the vendored tools match the plugin's copy byte for byte\n* text eol=lf\n";

export function recordedPreset(target) {
	const file = path.join(target, PRESET_MARKER);
	return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : null;
}

export function listPresets() {
	return fs
		.readdirSync(PRESETS_DIR, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
}

export function templatesFor(preset) {
	if (!listPresets().includes(preset)) throw new ConfigError(`unknown preset ${JSON.stringify(preset)}; choose one of: ${listPresets().join(", ")}`);
	const presetFiles = PRESET_FILES.filter((f) => fs.existsSync(path.join(PRESETS_DIR, preset, f))).map((f) => [`templates/presets/${preset}/${f}`, `.stack-agent/${f}`]);
	// a preset without an API map gets the feature map: where each thing a user does lives in the code
	const featureMap = fs.existsSync(path.join(PRESETS_DIR, preset, "api-map.json")) ? [] : [[FEATURE_MAP_TEMPLATE, FEATURE_MAP]];
	return [...presetFiles, ...featureMap, ...COMMON];
}

const realpath = (p) => {
	try {
		return fs.realpathSync.native(p);
	} catch {
		return path.resolve(p);
	}
};

// GitHub reads workflows only from .github/workflows at the top of the repository. A project in a subfolder of a
// git repo (a monorepo) gets its own workflow there, running in its folder and only when its files change.
// Returns { abs, shown, sub } where sub is the project's posix path inside the repo ("" at the top or outside git).
export function workflowLocation(target) {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: target, encoding: "utf8" });
	const top = r.status === 0 ? realpath(r.stdout.trim()) : null;
	const sub = top ? toPosix(path.relative(top, realpath(target))) : "";
	if (!top || !sub || sub.startsWith("..")) return { abs: path.join(target, ROOT_WORKFLOW), shown: ROOT_WORKFLOW, sub: "" };
	const file = `stack-agent-${sub.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}.yml`;
	return { abs: path.join(top, ".github", "workflows", file), shown: toPosix(path.relative(target, path.join(top, ".github", "workflows", file))), sub, file };
}

// The branch origin/HEAD points at (the remote's default branch), or null when the clone does not know it.
export function defaultBranch(target) {
	const r = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { cwd: target, encoding: "utf8" });
	const name = r.status === 0 ? r.stdout.trim().replace(/^origin\//, "") : "";
	return name || null;
}

// A repository that was pushed rather than cloned has origin/<branch> but no origin/HEAD. When exactly one of
// origin/main and origin/master exists, it is the likely default branch. It is a guess (an old origin/main can sit
// next to a default branch named develop), so --check keeps saying that it was guessed until origin/HEAD is set.
export function guessedDefaultBranch(target) {
	if (defaultBranch(target)) return null;
	const exists = (b) => spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${b}`], { cwd: target, encoding: "utf8" }).status === 0;
	const found = ["main", "master"].filter(exists);
	return found.length === 1 ? found[0] : null;
}

const PUSH_BRANCHES = /^ {4}branches: \[(.*)\]$/m;

// the template runs on pushes to main; a repository whose default branch has another name gets that one
export function withBranch(text, branch) {
	if (!branch || branch === "main") return text;
	if (!PUSH_BRANCHES.test(text)) throw new Error("init: the CI template no longer has a push branches line; update withBranch");
	return text.replace(PUSH_BRANCHES, `    branches: [${JSON.stringify(branch)}]`);
}

// what --check says about the push branch: a note when the workflow names another branch than the default one,
// or when the default branch is unknown and the workflow still says main
export function branchNote(target) {
	const workflow = workflowLocation(target);
	if (!fs.existsSync(workflow.abs)) return null;
	const m = PUSH_BRANCHES.exec(fs.readFileSync(workflow.abs, "utf8"));
	if (!m) return null;
	const listed = m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, ""));
	// outside a git repository there is no branch to compare with
	if (spawnSync("git", ["rev-parse", "--git-dir"], { cwd: target, encoding: "utf8" }).status !== 0) return null;
	const branch = defaultBranch(target);
	if (branch && !listed.includes(branch)) return `${workflow.shown} runs on pushes to ${listed.join(", ")}, but the repository's default branch is ${branch}; add it to "branches" so pushes to it run CI`;
	const guessed = guessedDefaultBranch(target);
	if (guessed)
		return `${workflow.shown} runs on pushes to ${listed.join(", ")}; there is no origin/HEAD, so the default branch was taken to be ${guessed} because origin/${guessed} exists. If yours is another, change "branches" (\`git remote set-head origin --auto\` records the real one and ends this note)`;
	if (!branch && listed.length === 1 && listed[0] === "main")
		return `${workflow.shown} runs on pushes to main; the default branch is not known yet (no origin/HEAD), so change "branches" if yours has another name (\`git remote set-head origin --auto\` records it once the remote exists)`;
	return null;
}

// The project's folder and, for a project in a subfolder of a repository (a monorepo), the repository's top folder,
// where a shared .nvmrc, Prettier, or ESLint config usually lives.
function projectDirs(target) {
	const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: target, encoding: "utf8" });
	const top = r.status === 0 ? realpath(r.stdout.trim()) : null;
	return top && realpath(target) !== top ? [target, top] : [target];
}

// Stack Agent's own scripts need Node 22, so the workflow never goes below it
const MIN_NODE = 22;
// a node-version line, keeping a trailing comment: `node-version: 22 # pinned`
const NODE_VERSION = /^(\s+node-version: )(["']?)(\d[^\s"'#]*|[^\s"'#]+)\2(\s+#.*)?$/gm;

// The lowest Node major a package.json "engines.node" range allows: the lower bound of each "||" alternative
// (">=24.11", "^20", "22.x", "24"), the smallest across alternatives. null when an alternative has no lower bound
// ("<25", "*"), because then any old version is allowed and there is nothing to raise the workflow to.
export function lowestEnginesMajor(range) {
	if (typeof range !== "string" || !range.trim()) return null;
	let lowest = null;
	for (const alt of range.split("||")) {
		// a token that sets a lower bound: ">=24.11", ">20", "^20", "~22.1", "=24", "v24", "22.x", "24" (also the start of "20 - 24")
		const bound = alt
			.trim()
			.split(/\s+/)
			.map((t) => /^(?:>=?|\^|~|=|v)?(\d+)[.\dxX*]*$/.exec(t))
			.find(Boolean);
		if (!bound) return null;
		const lower = Number(bound[1]);
		lowest = lowest === null ? lower : Math.min(lowest, lower);
	}
	return lowest;
}

// The Node major version the project asks for: .nvmrc or .node-version first (they name one version; # comment lines
// are skipped), then the lowest version package.json "engines.node" allows. The project's folder is read first, then
// the top of the repository. null when none of them names a number (e.g. "lts/*").
export function projectNodeMajor(target) {
	for (const dir of projectDirs(target)) {
		for (const file of [".nvmrc", ".node-version"]) {
			const abs = path.join(dir, file);
			if (!fs.existsSync(abs)) continue;
			const line = fs.readFileSync(abs, "utf8").split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
			const m = /^v?(\d+)/.exec(line ?? "");
			if (m) return Number(m[1]);
		}
		try {
			const major = lowestEnginesMajor(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))?.engines?.node);
			if (major) return major;
		} catch {}
	}
	return null;
}

// the template's node-version lines, raised to the project's Node version when it needs a newer one
export function withNodeVersion(text, major) {
	if (!major || major <= MIN_NODE) return text;
	// only numeric versions are raised; a name like lts/* is the project's own choice
	return text.replace(NODE_VERSION, (line, lead, quote, version, comment = "") => (/^\d/.test(version) ? `${lead}${quote}${major}${quote}${comment}` : line));
}

// what --check says when a workflow runs an older Node than the project asks for, or older than Stack Agent needs
export function nodeNote(target) {
	const workflow = workflowLocation(target);
	if (!fs.existsSync(workflow.abs)) return null;
	const major = projectNodeMajor(target);
	const need = Math.max(MIN_NODE, major ?? 0);
	const older = [...fs.readFileSync(workflow.abs, "utf8").matchAll(NODE_VERSION)].map((m) => Number(/^\d+/.exec(m[3])?.[0])).filter((v) => v && v < need);
	if (!older.length) return null;
	return major && major >= MIN_NODE
		? `${workflow.shown} sets node-version ${older[0]}, but the project asks for Node ${major} (.nvmrc, .node-version, or engines.node); raise node-version so CI runs what the project needs`
		: `${workflow.shown} sets node-version ${older[0]}, but Stack Agent's scripts need Node ${MIN_NODE}; raise node-version to at least ${MIN_NODE}`;
}

// The vendored tools are copied byte for byte (--check compares them), and guard-baseline.json is written by the
// guard, so a project's formatter or linter must leave .stack-agent/ alone: reformatting would make the tools
// "outdated", and a lint or format check in CI fails on them (66 eslint errors and 9 prettier files in the first
// real install). init adds .stack-agent/ to .prettierignore and .eslintignore when the project uses them.
// gitignore-style, so it matches the folder at any depth: one line at the top of a monorepo covers every project in it
const STACK_AGENT_IGNORE = ".stack-agent/";
const CONFIG_EXTS = ["js", "cjs", "mjs", "ts", "cts", "mts"];
const PRETTIER_CONFIGS = [".prettierrc", ...["json", "json5", "yaml", "yml", "toml", ...CONFIG_EXTS].map((e) => `.prettierrc.${e}`), ...CONFIG_EXTS.map((e) => `prettier.config.${e}`)];
const ESLINT_FLAT_CONFIGS = CONFIG_EXTS.map((e) => `eslint.config.${e}`);
// .stack-agent, /.stack-agent/, **/.stack-agent/**, .stack-agent/*, .stack-agent/**/* all ignore the folder
const IGNORE_LINE = /^(\/|\*\*\/)?\.stack-agent(\/(\*\*(\/\*)?|\*)?)?$/;

function packageJson(dir) {
	try {
		return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
	} catch {
		return null;
	}
}

// Prettier is in use when it has a config or ignore file, a "prettier" key in package.json, or is a dependency
// (many projects run `prettier --check .` with its defaults and no config file)
function usesPrettier(dir) {
	if ([".prettierignore", ...PRETTIER_CONFIGS].some((f) => fs.existsSync(path.join(dir, f)))) return true;
	const pkg = packageJson(dir);
	return pkg?.prettier !== undefined || pkg?.devDependencies?.prettier !== undefined || pkg?.dependencies?.prettier !== undefined;
}

// Appends .stack-agent/ to the ignore files of the formatter and linter the project uses, in the project's folder
// and at the top of its repository (a root `prettier --check .` reads only the root .prettierignore). A file that
// already ignores the folder, or un-ignores it on purpose with "!", is left alone. Returns report lines.
export function ignoreInFormatters(target) {
	const report = [];
	for (const dir of projectDirs(target)) {
		const files = [...(usesPrettier(dir) ? [".prettierignore"] : []), ...(fs.existsSync(path.join(dir, ".eslintignore")) ? [".eslintignore"] : [])];
		for (const file of files) {
			const abs = path.join(dir, file);
			const shown = toPosix(path.relative(target, abs));
			const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
			if (current.split(/\r?\n/).some((l) => IGNORE_LINE.test(l.trim().replace(/^!/, "")))) {
				report.push(`kept     ${shown} (already says how to treat .stack-agent/)`);
				continue;
			}
			const eol = current.includes("\r\n") ? "\r\n" : "\n";
			fs.writeFileSync(abs, current + (current && !current.endsWith("\n") ? eol : "") + STACK_AGENT_IGNORE + eol);
			report.push(`${current ? "updated " : "created "} ${shown} (+ ${STACK_AGENT_IGNORE}, so the formatter leaves the vendored tools alone)`);
		}
	}
	return report;
}

// what --check says about an ESLint flat config, which init cannot edit safely: a note when it never names .stack-agent
export function lintNote(target) {
	for (const dir of projectDirs(target)) {
		const file = ESLINT_FLAT_CONFIGS.find((f) => fs.existsSync(path.join(dir, f)));
		if (!file || fs.readFileSync(path.join(dir, file), "utf8").includes(".stack-agent")) continue;
		return `${toPosix(path.relative(target, path.join(dir, file)))} does not mention .stack-agent, so \`eslint .\` lints the vendored tools in .stack-agent/bin and fails on them; add "**/.stack-agent/**" to its ignores`;
	}
	return null;
}

// the template, rewritten for a project in subfolder `sub` of the repository
export function subfolderWorkflow(text, sub, file) {
	const q = JSON.stringify;
	text = text.replace(/\r\n/g, "\n");
	const paths = `    paths: [${q(sub + "/**")}, ${q(".github/workflows/" + file)}]\n`;
	const edits = [
		["name: stack-agent\n", `name: ${q("stack-agent (" + sub + ")")}\n`],
		["  pull_request:\n", "  pull_request:\n" + paths],
		["    branches: [main]\n", "    branches: [main]\n" + paths],
		["\njobs:\n", `\ndefaults:\n  run:\n    working-directory: ${q(sub)}\n\njobs:\n`],
		["hashFiles('.stack-agent/api-map.json')", `hashFiles('${sub}/.stack-agent/api-map.json')`],
		["hashFiles('.stack-agent/feature-map.md')", `hashFiles('${sub}/.stack-agent/feature-map.md')`],
		["path: .stack-agent/evidence/", `path: ${sub}/.stack-agent/evidence/`],
	];
	for (const [from, to] of edits) {
		if (!text.includes(from)) throw new Error(`init: the CI template no longer contains ${q(from)}; update subfolderWorkflow`);
		text = text.replace(from, to);
	}
	return text;
}

// The feature map template up to 0.4.0 said this in its instructions, so a finished map installed then still
// contains "EDIT ME" in prose; init never rewrites the file, so the check skips this exact sentence.
const OLD_FEATURE_MAP_INSTRUCTION = "replace every EDIT ME, and leave";

export function pendingSetup(target) {
	const pending = [];
	const usesApiMap = fs.existsSync(path.join(target, ".stack-agent/api-map.json"));
	const workflow = workflowLocation(target);
	const usesFeatureMap = fs.existsSync(path.join(target, FEATURE_MAP));
	const required = [...ALWAYS_REQUIRED.map((dest) => [path.join(target, dest), dest]), [workflow.abs, workflow.shown], ...(usesApiMap ? [[path.join(target, ".stack-agent/api-map.json"), ".stack-agent/api-map.json"]] : []), ...(usesFeatureMap ? [[path.join(target, FEATURE_MAP), FEATURE_MAP]] : [])];
	for (const [abs, dest] of required) {
		if (!fs.existsSync(abs)) pending.push(`${dest}: missing`);
		else if (fs.readFileSync(abs, "utf8").replaceAll(OLD_FEATURE_MAP_INSTRUCTION, "").includes("EDIT ME")) pending.push(`${dest}: still has EDIT ME placeholders`);
	}
	if (workflow.sub && fs.existsSync(path.join(target, ROOT_WORKFLOW)))
		pending.push(`${ROOT_WORKFLOW}: GitHub never runs it, because this project is in the subfolder ${workflow.sub} of its repository; use ${workflow.shown} instead (rerun init to create it) and delete this one`);
	if (usesApiMap && !fs.existsSync(path.join(target, ".stack-agent/api-map.md"))) pending.push(".stack-agent/api-map.md: missing, create it with `node .stack-agent/bin/api-map.mjs --draft`");
	if (!fs.existsSync(path.join(target, ".stack-agent/guard-baseline.json"))) pending.push(".stack-agent/guard-baseline.json: missing, record existing violations with `node .stack-agent/bin/guard.mjs --update-baseline`");
	const outdated = outdatedTools(target);
	for (const rel of outdated) pending.push(`outdated: ${BIN}/${rel}${fs.existsSync(path.join(target, BIN, rel)) ? "" : " (missing)"}`);
	if (outdated.length) {
		const arg = (p) => (/\s/.test(p) ? JSON.stringify(p) : p);
		const where = toPosix(path.relative(process.cwd(), target)) || ".";
		pending.push(`${BIN}: differs from Stack Agent ${pluginVersion()}, refresh it with \`node ${arg(toPosix(path.join(pluginRoot, "scripts", "init.mjs")))} ${arg(where)}\``);
	}
	return pending;
}

// Rules every preset ships. A project set up before one of them was added does not have it, because init never
// rewrites an existing config, so the check names it. A rule left out on purpose goes in "declinedRules".
export function universalRules() {
	const per = listPresets().map((p) => JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, p, "guard.config.json"), "utf8")).rules.map((r) => r.id));
	return per.reduce((acc, ids) => acc.filter((id) => ids.includes(id)));
}

export function missingRules(target) {
	const file = path.join(target, ".stack-agent/guard.config.json");
	let config;
	try {
		config = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return [];
	}
	// a config the guard would reject gets no advice here; the guard names what is wrong with it
	if (!Array.isArray(config?.rules) && config?.extends === undefined) return [];
	// rules from shared files (extends) count as the project's own
	let rules = config.rules ?? [];
	if (config.extends !== undefined) {
		try {
			rules = loadConfig(file).rules;
		} catch {
			return [];
		}
	}
	const have = new Set(rules.map((r) => r?.id));
	const declined = new Set(Array.isArray(config.declinedRules) ? config.declinedRules : []);
	return universalRules().filter((id) => !have.has(id) && !declined.has(id));
}

// Rules shared across repositories. "extends" only reads files inside the repository (so CI and --compare-ref can
// read them), so a team's rules file kept elsewhere is vendored like the tools: copied to
// .stack-agent/shared-rules.json, with its source recorded so every later init refreshes it and --check reports a
// copy that differs from the source.
export const SHARED_RULES = ".stack-agent/shared-rules.json";
const SHARED_SOURCE = ".stack-agent/shared-rules.source";

export function vendorSharedRules(target, source) {
	const abs = path.resolve(source);
	let text;
	try {
		text = fs.readFileSync(abs, "utf8");
	} catch {
		throw new ConfigError(`--shared-rules: cannot read ${abs}`);
	}
	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (err) {
		throw new ConfigError(`--shared-rules: ${abs} is not valid JSON: ${err.message}`);
	}
	if (!Array.isArray(parsed?.rules) || !parsed.rules.length) throw new ConfigError(`--shared-rules: ${abs} needs a non-empty rules array`);
	if (parsed.extends !== undefined) throw new ConfigError(`--shared-rules: ${abs} uses extends; vendor one self-contained file`);
	const dest = path.join(target, SHARED_RULES);
	const same = fs.existsSync(dest) && fs.readFileSync(dest, "utf8") === text;
	fs.mkdirSync(path.dirname(dest), { recursive: true });
	if (!same) fs.writeFileSync(dest, text);
	fs.writeFileSync(path.join(target, SHARED_SOURCE), abs + "\n");
	return `${same ? "unchanged" : "updated  "} ${SHARED_RULES} (from ${toPosix(abs)})`;
}

export function sharedRulesSource(target) {
	const file = path.join(target, SHARED_SOURCE);
	return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() || null : null;
}

// what --check says about the vendored shared rules: pending when the copy differs from a source that is still there,
// or when guard.config.json does not extend it; a note when the source cannot be read from this machine
export function sharedRulesStatus(target) {
	const source = sharedRulesSource(target);
	if (!source) return { pending: [], notes: [] };
	const pending = [];
	const notes = [];
	const dest = path.join(target, SHARED_RULES);
	if (!fs.existsSync(source)) notes.push(`${SHARED_RULES} comes from ${toPosix(source)}, which this machine cannot read, so it was not compared`);
	else if (!fs.existsSync(dest) || fs.readFileSync(dest, "utf8") !== fs.readFileSync(source, "utf8")) pending.push(`outdated: ${SHARED_RULES} differs from ${toPosix(source)}; rerun init to refresh it`);
	let config = null;
	try {
		config = JSON.parse(fs.readFileSync(path.join(target, ".stack-agent/guard.config.json"), "utf8"));
	} catch {}
	const extendsIt = Array.isArray(config?.extends) && config.extends.some((e) => path.resolve(target, ".stack-agent", e) === path.resolve(dest));
	if (config && !extendsIt) pending.push(`.stack-agent/guard.config.json does not use ${SHARED_RULES}; add "extends": ["shared-rules.json"] to it`);
	return { pending, notes };
}

export function init(target, preset = "generic") {
	const report = [];
	for (const [tool, src] of vendoredFiles()) {
		const dest = path.join(target, BIN, tool);
		const existed = fs.existsSync(dest);
		const same = existed && sameTool(fs.readFileSync(dest), src);
		if (!same) {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.writeFileSync(dest, src);
		}
		report.push(`${same ? "unchanged" : existed ? "updated  " : "created  "} .stack-agent/bin/${tool}`);
	}
	// a project set up before the feature map existed, or one that deleted it, does not get it back on a rerun
	// that only refreshes the tools; `feature-map.mjs --draft` starts one by hand
	const settingUp = !fs.existsSync(path.join(target, ".stack-agent/verify.json")) && !fs.existsSync(path.join(target, ".stack-agent/api-map.json"));
	for (const [src, dest] of templatesFor(preset)) {
		const abs = path.join(target, dest);
		if (fs.existsSync(abs)) {
			report.push(`kept     ${dest} (already exists, not overwritten)`);
			continue;
		}
		if (dest === FEATURE_MAP && !settingUp) continue;
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.copyFileSync(path.join(pluginRoot, src), abs);
		report.push(`created  ${dest}`);
	}
	const workflow = workflowLocation(target);
	if (fs.existsSync(workflow.abs)) report.push(`kept     ${workflow.shown} (already exists, not overwritten)`);
	else {
		const text = fs.readFileSync(path.join(pluginRoot, WORKFLOW_TEMPLATE), "utf8");
		fs.mkdirSync(path.dirname(workflow.abs), { recursive: true });
		const rewritten = withBranch(workflow.sub ? subfolderWorkflow(text, workflow.sub, workflow.file) : text, defaultBranch(target) ?? guessedDefaultBranch(target));
		fs.writeFileSync(workflow.abs, withNodeVersion(rewritten, projectNodeMajor(target)));
		report.push(`created  ${workflow.shown}${workflow.sub ? ` (at the top of the repository, running in ${workflow.sub})` : ""}`);
	}
	if (!recordedPreset(target)) {
		fs.writeFileSync(path.join(target, PRESET_MARKER), preset + "\n");
		report.push(`created  ${PRESET_MARKER} (${preset})`);
	}
	const gitignore = path.join(target, ".gitignore");
	const current = fs.existsSync(gitignore) ? fs.readFileSync(gitignore, "utf8") : "";
	const ignoresEvidence = current.split(/\r?\n/).some((l) => ["/.stack-agent/evidence", ".stack-agent/evidence", ".stack-agent/evidence/**"].includes(l.trim().replace(/\/$/, "")) || l.trim() === "/.stack-agent/evidence/");
	if (ignoresEvidence) report.push("kept     .gitignore (evidence dir already ignored)");
	else {
		fs.writeFileSync(gitignore, current + (current && !current.endsWith("\n") ? "\n" : "") + GITIGNORE_LINE + "\n");
		report.push("updated  .gitignore (+ .stack-agent/evidence/)");
	}
	report.push(...ignoreInFormatters(target));
	const attributes = path.join(target, STACK_AGENT_ATTRIBUTES);
	if (!fs.existsSync(attributes)) {
		fs.writeFileSync(attributes, ATTRIBUTES_TEXT);
		report.push(`created  ${STACK_AGENT_ATTRIBUTES} (LF line endings on every OS)`);
	}
	return report;
}

function main(argv) {
	const args = parseArgs(argv, { flags: ["check", "help", "list-presets"], options: ["preset", "shared-rules"] });
	if (args.help) return { code: 0, text: USAGE };
	if (args["list-presets"]) return { code: 0, text: listPresets().join("\n") };
	if (args._.length > 1) throw new ConfigError("give at most one target directory");
	// the real path: git reports the repository top that way, and paths shown relative to it must not climb out
	const target = realPath(args._[0] ?? process.cwd());
	if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new ConfigError(`target is not a directory: ${target}`);
	if (path.resolve(target) === pluginRoot) throw new ConfigError("target is the Stack Agent repo itself; run this inside the project you want to set up");
	const recorded = recordedPreset(target);
	const preset = args.preset ?? recorded ?? "generic";
	templatesFor(preset);
	if (!args.check && recorded && recorded !== preset)
		throw new ConfigError(`this repo was set up with preset ${recorded}; mixing in ${preset} would keep ${recorded}'s configs. To switch, delete ${PRESET_MARKER} and the .stack-agent/*.json files you want replaced, then rerun`);
	const lines = args.check ? [] : [`preset: ${preset}`, ...init(target, preset)];
	// the shared rules are refreshed like the tools: from --shared-rules, or from the source recorded last time
	const sharedFrom = args["shared-rules"] ?? (!args.check && sharedRulesSource(target) && fs.existsSync(sharedRulesSource(target)) ? sharedRulesSource(target) : null);
	if (sharedFrom && !args.check) lines.push(vendorSharedRules(target, sharedFrom));
	const shared = sharedRulesStatus(target);
	const pending = [...pendingSetup(target), ...shared.pending];
	lines.push(pending.length ? `\nsetup unfinished in ${toPosix(target)}:\n${pending.map((p) => "  - " + p).join("\n")}` : `\nsetup complete in ${toPosix(target)}`);
	const notes = shared.notes.map((n) => `  - ${n}`);
	const missing = missingRules(target);
	if (missing.length) {
		const from = toPosix(path.join(PRESETS_DIR, recorded && listPresets().includes(recorded) ? recorded : preset, "guard.config.json"));
		notes.push(...missing.map((id) => `  - guard rule ${id} is in every preset but not in .stack-agent/guard.config.json; copy the rule from ${from} into it, or add "${id}" to "declinedRules" in your .stack-agent/guard.config.json to leave it out on purpose`));
	}
	for (const note of [branchNote(target), nodeNote(target), lintNote(target)]) if (note) notes.push(`  - ${note}`);
	if (notes.length) lines.push(`\nnotes (do not affect the exit code):`, ...notes);
	return { code: args.check && pending.length ? 1 : 0, text: lines.join("\n") };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		console.log(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`init: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
