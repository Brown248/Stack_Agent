#!/usr/bin/env node
// Checks that a release is consistent and writes its GitHub Release notes. A release is a tag vX.Y.Z; the Release made
// from it must say what the changelog says, in a version the three version files agree on. This refuses (exit 1, every
// problem listed) when the tag is not the version in plugin.json, marketplace.json, and package.json, or when the
// newest release section of CHANGELOG.md or CHANGELOG.th.md is another version, or has no text. Otherwise it gives the
// section, a link to the Thai changelog at that tag, the title, whether it is a pre-release, and whether it is the
// highest release (the one GitHub should mark Latest). .github/workflows/release.yml publishes with the answer.
// Not vendored by init and not part of a project's setup: it belongs to this repo's own releases.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, parseArgs } from "./lib/files.mjs";

const USAGE = `usage: node scripts/release-notes.mjs [--tag vX.Y.Z] [--root DIR] [--repo OWNER/NAME] [--ref GIT_REF]
                                       [--out FILE] [--github-output FILE] [--json]
  --tag            the release tag (default: v plus the version in plugin.json)
  --root           the project to check (default: this repo)
  --repo           OWNER/NAME for the Thai changelog link (default: $GITHUB_REPOSITORY, else the origin remote)
  --ref            read the files as they are at this tag or commit, not in the working tree
  --out            write the notes to this file (the summary is printed instead)
  --github-output  append title, version, prerelease, and latest to this file (the workflow's $GITHUB_OUTPUT)
  --json           print title, version, prerelease, latest, and the notes as JSON
prints the notes when none of --out, --json is given
exit codes: 0 consistent, 1 not ready (every problem is listed), 2 usage error`;

const here = path.dirname(fileURLToPath(import.meta.url));
const TAG = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// 1.2.3 and 1.2.3-rc.1, as semver orders them: numbers by value, a pre-release below its release
export function semverCompare(a, b) {
	const split = (v) => {
		const [core, pre] = v.split(/-(.+)/);
		return { nums: core.split(".").map(Number), pre: pre ? pre.split(".") : null };
	};
	const x = split(a);
	const y = split(b);
	for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
	if (!x.pre && !y.pre) return 0;
	if (!x.pre) return 1;
	if (!y.pre) return -1;
	for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
		const p = x.pre[i];
		const q = y.pre[i];
		if (p === undefined) return -1;
		if (q === undefined) return 1;
		const pn = /^\d+$/.test(p);
		const qn = /^\d+$/.test(q);
		if (pn && qn) {
			if (Number(p) !== Number(q)) return Number(p) - Number(q);
		} else if (pn !== qn) return pn ? -1 : 1;
		else if (p !== q) return p < q ? -1 : 1;
	}
	return 0;
}

function reader(root, ref) {
	if (!ref) {
		return (rel) => {
			try {
				return fs.readFileSync(path.join(root, rel), "utf8");
			} catch {
				return null;
			}
		};
	}
	if (!/^[\w][\w./-]*$/.test(ref)) throw new ConfigError(`--ref: ${ref} is not a tag or commit name`);
	return (rel) => {
		const r = spawnSync("git", ["show", `${ref}:${rel}`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
		return r.status === 0 ? r.stdout : null;
	};
}

function jsonVersion(read, rel, pick) {
	const text = read(rel);
	if (text === null) return { missing: true };
	try {
		return { version: pick(JSON.parse(text)) };
	} catch {
		return { invalid: true };
	}
}

const releaseHeadings = (text) => [...text.matchAll(/^## (\S+)/gm)].map((m) => m[1]).filter((h) => VERSION.test(h));

// the text of the section "## <version> ..." up to the next "## ", without its heading
function sectionOf(text, version) {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const start = lines.findIndex((l) => /^## \S/.test(l) && l.slice(3).split(/\s/)[0] === version);
	if (start < 0) return null;
	let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
	if (end < 0) end = lines.length;
	return lines.slice(start + 1, end).join("\n").trim();
}

function repoName(args, env, root) {
	let repo = args.repo ?? env.GITHUB_REPOSITORY;
	if (!repo) {
		const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" });
		repo = r.status === 0 ? /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(r.stdout)?.[1] : undefined;
	}
	if (!repo) throw new ConfigError("--repo OWNER/NAME is needed: it is not in GITHUB_REPOSITORY and there is no origin remote on GitHub");
	if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new ConfigError(`--repo: ${repo} is not OWNER/NAME`);
	return repo;
}

function knownTags(root) {
	const r = spawnSync("git", ["tag", "--list", "v*"], { cwd: root, encoding: "utf8" });
	return r.status === 0 ? r.stdout.split("\n").map((t) => t.trim()).filter((t) => TAG.test(t)) : [];
}

export function main(argv, env = process.env) {
	const args = parseArgs(argv, { flags: ["json", "help"], options: ["tag", "root", "repo", "ref", "out", "github-output"] });
	if (args.help) return { code: 0, text: USAGE };
	const root = path.resolve(args.root ?? path.join(here, ".."));
	const read = reader(root, args.ref);

	const plugin = jsonVersion(read, ".claude-plugin/plugin.json", (j) => ({ version: j.version, name: j.name }));
	const pluginVersion = plugin.version?.version;
	const tag = args.tag ?? (pluginVersion ? `v${pluginVersion}` : undefined);
	if (!tag) throw new ConfigError("--tag is needed: .claude-plugin/plugin.json has no version to take it from");
	const match = TAG.exec(tag);
	if (!match) throw new ConfigError(`--tag: ${tag} is not vMAJOR.MINOR.PATCH (a pre-release may add -name.N)`);
	const version = match[1];
	const prerelease = version.includes("-");
	const repo = repoName(args, env, root);

	const problems = [];
	// the three files that carry the version
	const files = [
		[".claude-plugin/plugin.json", plugin.version ? { version: plugin.version.version } : plugin],
		[".claude-plugin/marketplace.json", jsonVersion(read, ".claude-plugin/marketplace.json", (j) => (j.plugins ?? []).find((p) => p.name === plugin.version?.name)?.version ?? j.plugins?.[0]?.version)],
		["package.json", jsonVersion(read, "package.json", (j) => j.version)],
	];
	for (const [rel, found] of files) {
		if (found.missing) problems.push(`${rel}: not found`);
		else if (found.invalid) problems.push(`${rel}: is not valid JSON`);
		else if (found.version !== version) problems.push(`${rel}: the version is ${JSON.stringify(found.version ?? null)}, the tag ${tag} says "${version}"`);
	}
	// the changelogs: the newest release section is this version, and the English one has text to publish
	let body = "";
	for (const rel of ["CHANGELOG.md", "CHANGELOG.th.md"]) {
		const text = read(rel);
		if (text === null) {
			problems.push(`${rel}: not found`);
			continue;
		}
		const newest = releaseHeadings(text)[0];
		if (newest !== version) problems.push(`${rel}: the newest release section is ${newest ?? "missing"}, not ${version}`);
		else if (rel === "CHANGELOG.md") {
			body = sectionOf(text, version) ?? "";
			if (!body) problems.push(`${rel}: the section for ${version} has no text`);
		}
	}
	if (problems.length) return { code: 1, text: `release-notes: ${tag} is not ready:\n${problems.map((p) => `  - ${p}`).join("\n")}` };

	const stable = [...new Set([...knownTags(root), tag])].filter((t) => !t.includes("-", 1));
	const latest = !prerelease && stable.every((t) => semverCompare(version, t.slice(1)) >= 0);
	const notes = `${body}\n\nภาษาไทย: [CHANGELOG.th.md](https://github.com/${repo}/blob/${tag}/CHANGELOG.th.md)\n`;
	const result = { tag, version, title: `Stack Agent ${version}`, prerelease, latest, notes };

	if (args.out) {
		fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
		fs.writeFileSync(args.out, notes);
	}
	if (args["github-output"]) fs.appendFileSync(args["github-output"], `title=${result.title}\nversion=${version}\nprerelease=${prerelease}\nlatest=${latest}\n`);
	if (args.json) return { code: 0, text: JSON.stringify(result, null, 2) };
	if (args.out) return { code: 0, text: `release-notes: ${tag} is consistent; notes written to ${args.out} (${prerelease ? "pre-release" : "release"}, ${latest ? "the latest" : "not the latest"})` };
	return { code: 0, text: notes.trimEnd() };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const { code, text } = main(process.argv.slice(2));
		(code === 0 ? console.log : console.error)(text);
		process.exitCode = code;
	} catch (err) {
		if (!(err instanceof ConfigError)) throw err;
		console.error(`release-notes: ${err.message}\n${USAGE}`);
		process.exitCode = 2;
	}
}
