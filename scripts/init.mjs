#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const TOOLS = ["guard.mjs", "verify.mjs", "api-map.mjs", "lib/files.mjs", "lib/fingerprint.mjs"];
const PRESETS_DIR = path.join(pluginRoot, "templates", "presets");
const COMMON = [
	["templates/common/rules.md", ".stack-agent/rules.md"],
	["templates/common/rules-table.md", ".stack-agent/rules-table.md"],
	["templates/ci/stack-agent.yml", ".github/workflows/stack-agent.yml"],
];
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
	return [...presetFiles, ...COMMON];
}

export function pendingSetup(target) {
	const pending = [];
	const usesApiMap = fs.existsSync(path.join(target, ".stack-agent/api-map.json"));
	for (const dest of [...ALWAYS_REQUIRED, ...(usesApiMap ? [".stack-agent/api-map.json"] : [])]) {
		const abs = path.join(target, dest);
		if (!fs.existsSync(abs)) pending.push(`${dest}: missing`);
		else if (fs.readFileSync(abs, "utf8").includes("EDIT ME")) pending.push(`${dest}: still has EDIT ME placeholders`);
	}
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
	if (!Array.isArray(config?.rules)) return [];
	const have = new Set(config.rules.map((r) => r?.id));
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
	for (const [src, dest] of templatesFor(preset)) {
		const abs = path.join(target, dest);
		if (fs.existsSync(abs)) {
			report.push(`kept     ${dest} (already exists, not overwritten)`);
			continue;
		}
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.copyFileSync(path.join(pluginRoot, src), abs);
		report.push(`created  ${dest}`);
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
	const missing = missingRules(target);
	if (missing.length) {
		const from = toPosix(path.join(PRESETS_DIR, recorded && listPresets().includes(recorded) ? recorded : preset, "guard.config.json"));
		lines.push(`\nnotes (do not affect the exit code):`, ...missing.map((id) => `  - guard rule ${id} is in every preset but not in .stack-agent/guard.config.json; copy the rule from ${from} into it, or add "${id}" to "declinedRules" in your .stack-agent/guard.config.json to leave it out on purpose`));
	}
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
