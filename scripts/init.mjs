#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./guard.mjs";
import { ConfigError, parseArgs, toPosix } from "./lib/files.mjs";

const USAGE = `usage: node init.mjs [TARGET_DIR] [--preset NAME] [--check] [--list-presets]
  copies the Stack Agent tools into TARGET_DIR/.stack-agent/bin (refreshed on every run),
  adds config templates for the chosen preset and a CI workflow only where none exist,
  and ignores the evidence dir.
  --preset NAME   project type: generic (default), backend-http, cli, library, frontend-web
  --check         only report setup that is still unfinished (EDIT ME placeholders, missing files,
                  vendored tools in .stack-agent/bin that differ from this plugin's copy), and note any rule
                  every preset ships that the guard config lacks (a note only; "declinedRules" silences it)
  --list-presets  print the available presets
exit codes: 0 done / setup complete, 1 setup still unfinished, 2 usage error`;

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

export function outdatedTools(target) {
	return vendoredFiles()
		.filter(([rel, src]) => {
			const dest = path.join(target, BIN, rel);
			return !fs.existsSync(dest) || Buffer.compare(fs.readFileSync(dest), src) !== 0;
		})
		.map(([rel]) => rel);
}

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
	if (!branch && listed.length === 1 && listed[0] === "main") return `${workflow.shown} runs on pushes to main; the default branch is not known yet (no origin/HEAD), so change "branches" if yours has another name`;
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

export function pendingSetup(target) {
	const pending = [];
	const usesApiMap = fs.existsSync(path.join(target, ".stack-agent/api-map.json"));
	const workflow = workflowLocation(target);
	const usesFeatureMap = fs.existsSync(path.join(target, FEATURE_MAP));
	const required = [...ALWAYS_REQUIRED.map((dest) => [path.join(target, dest), dest]), [workflow.abs, workflow.shown], ...(usesApiMap ? [[path.join(target, ".stack-agent/api-map.json"), ".stack-agent/api-map.json"]] : []), ...(usesFeatureMap ? [[path.join(target, FEATURE_MAP), FEATURE_MAP]] : [])];
	for (const [abs, dest] of required) {
		if (!fs.existsSync(abs)) pending.push(`${dest}: missing`);
		else if (fs.readFileSync(abs, "utf8").includes("EDIT ME")) pending.push(`${dest}: still has EDIT ME placeholders`);
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

export function init(target, preset = "generic") {
	const report = [];
	for (const [tool, src] of vendoredFiles()) {
		const dest = path.join(target, BIN, tool);
		const existed = fs.existsSync(dest);
		const same = existed && Buffer.compare(fs.readFileSync(dest), src) === 0;
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
		fs.writeFileSync(workflow.abs, withBranch(workflow.sub ? subfolderWorkflow(text, workflow.sub, workflow.file) : text, defaultBranch(target)));
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
	return report;
}

function main(argv) {
	const args = parseArgs(argv, { flags: ["check", "help", "list-presets"], options: ["preset"] });
	if (args.help) return { code: 0, text: USAGE };
	if (args["list-presets"]) return { code: 0, text: listPresets().join("\n") };
	if (args._.length > 1) throw new ConfigError("give at most one target directory");
	const target = path.resolve(args._[0] ?? process.cwd());
	if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new ConfigError(`target is not a directory: ${target}`);
	if (path.resolve(target) === pluginRoot) throw new ConfigError("target is the Stack Agent repo itself; run this inside the project you want to set up");
	const recorded = recordedPreset(target);
	const preset = args.preset ?? recorded ?? "generic";
	templatesFor(preset);
	if (!args.check && recorded && recorded !== preset)
		throw new ConfigError(`this repo was set up with preset ${recorded}; mixing in ${preset} would keep ${recorded}'s configs. To switch, delete ${PRESET_MARKER} and the .stack-agent/*.json files you want replaced, then rerun`);
	const lines = args.check ? [] : [`preset: ${preset}`, ...init(target, preset)];
	const pending = pendingSetup(target);
	lines.push(pending.length ? `\nsetup unfinished in ${toPosix(target)}:\n${pending.map((p) => "  - " + p).join("\n")}` : `\nsetup complete in ${toPosix(target)}`);
	const notes = [];
	const missing = missingRules(target);
	if (missing.length) {
		const from = toPosix(path.join(PRESETS_DIR, recorded && listPresets().includes(recorded) ? recorded : preset, "guard.config.json"));
		notes.push(...missing.map((id) => `  - guard rule ${id} is in every preset but not in .stack-agent/guard.config.json; copy the rule from ${from} into it, or add "${id}" to "declinedRules" in your .stack-agent/guard.config.json to leave it out on purpose`));
	}
	const branch = branchNote(target);
	if (branch) notes.push(`  - ${branch}`);
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
