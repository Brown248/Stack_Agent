// A release is a tag, and the GitHub Release made from it must say the same thing as the changelog, in a version that
// the three version files agree on. release-notes.mjs checks that before anything is published, and writes the notes.
// The workflow that publishes (release.yml) is tested at the bottom as text, as the canary's is.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main, semverCompare } from "../scripts/release-notes.mjs";
import { ConfigError } from "../scripts/lib/files.mjs";
import { git, repoRoot, tempDir, write } from "./helpers.mjs";

const REPO = "Acme/Widget";

// a small project whose version files and changelogs agree on `version`
function project(version = "1.2.3", { tags = [], enHead = version, thHead = version } = {}) {
	const dir = tempDir("stack-agent-release-");
	write(dir, ".claude-plugin/plugin.json", JSON.stringify({ name: "widget", version }));
	write(dir, ".claude-plugin/marketplace.json", JSON.stringify({ name: "m", plugins: [{ name: "widget", version }] }));
	write(dir, "package.json", JSON.stringify({ name: "widget", version }));
	write(dir, "CHANGELOG.md", `# Changelog\n\nintro\n\n## Unreleased\n\n- not yet\n\n## ${enHead} (2026-01-02)\n\nFirst line.\n\n### Fixed\n\n- A fix with \`code\`.\n\n## 1.0.0 (2026-01-01)\n\n- Old.\n`);
	write(dir, "CHANGELOG.th.md", `# บันทึก\n\n## ยังไม่ออกรุ่น\n\n- ยัง\n\n## ${thHead} (2026-01-02)\n\nบรรทัดแรก\n`);
	git(dir, "init", "-q", "-b", "main");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	for (const t of tags) git(dir, "tag", t);
	return dir;
}
const run = (dir, argv) => main(["--root", dir, "--repo", REPO, ...argv]);

test("a consistent release gives the changelog section plus the Thai link, and a title", () => {
	const dir = project();
	const r = run(dir, ["--tag", "v1.2.3", "--json"]);
	assert.equal(r.code, 0, r.text);
	const out = JSON.parse(r.text);
	assert.equal(out.title, "Stack Agent 1.2.3");
	assert.equal(out.version, "1.2.3");
	assert.equal(out.prerelease, false);
	assert.equal(out.notes, "First line.\n\n### Fixed\n\n- A fix with `code`.\n\nภาษาไทย: [CHANGELOG.th.md](https://github.com/Acme/Widget/blob/v1.2.3/CHANGELOG.th.md)\n");
	assert.ok(!out.notes.includes("## 1.0.0") && !out.notes.includes("Old."), "only this release's section");
});

test("without --tag it checks v plus the version in plugin.json", () => {
	const r = run(project("0.9.0"), ["--json"]);
	assert.equal(r.code, 0, r.text);
	assert.equal(JSON.parse(r.text).tag, "v0.9.0");
});

test("the notes go to --out, and the summary says so", () => {
	const dir = project();
	const out = path.join(dir, "notes.md");
	const r = run(dir, ["--tag", "v1.2.3", "--out", out]);
	assert.equal(r.code, 0, r.text);
	assert.match(fs.readFileSync(out, "utf8"), /^First line\./);
	assert.match(r.text, /v1\.2\.3/);
});

test("a tag that is not the version in the files is refused, naming each file that disagrees", () => {
	const r = run(project("1.2.3"), ["--tag", "v1.2.4"]);
	assert.equal(r.code, 1);
	for (const f of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "package.json"]) assert.ok(r.text.includes(f), `${f} named: ${r.text}`);
	assert.match(r.text, /1\.2\.4/);
});

test("one version file that disagrees is named, the others are not", () => {
	const dir = project("1.2.3");
	write(dir, "package.json", JSON.stringify({ name: "widget", version: "1.2.2" }));
	const r = run(dir, ["--tag", "v1.2.3"]);
	assert.equal(r.code, 1);
	assert.ok(r.text.includes("package.json"));
	assert.ok(!r.text.includes("plugin.json") && !r.text.includes("marketplace.json"), r.text);
});

test("a changelog whose newest release heading is another version is refused, in either language", () => {
	const en = run(project("1.2.3", { enHead: "1.2.2" }), ["--tag", "v1.2.3"]);
	assert.equal(en.code, 1);
	assert.match(en.text, /CHANGELOG\.md.*1\.2\.2/);
	const th = run(project("1.2.3", { thHead: "1.2.2" }), ["--tag", "v1.2.3"]);
	assert.equal(th.code, 1);
	assert.match(th.text, /CHANGELOG\.th\.md.*1\.2\.2/);
});

test("an empty changelog section is refused", () => {
	const dir = project();
	write(dir, "CHANGELOG.md", "# Changelog\n\n## 1.2.3 (2026-01-02)\n\n## 1.0.0 (2026-01-01)\n\n- Old.\n");
	const r = run(dir, ["--tag", "v1.2.3"]);
	assert.equal(r.code, 1);
	assert.match(r.text, /no text/);
});

test("a tag that is not vMAJOR.MINOR.PATCH is a usage error", () => {
	for (const bad of ["1.2.3", "v1.2", "release-1", "v1.2.3;rm", "v1.2.3 "]) assert.throws(() => run(project(), ["--tag", bad]), ConfigError, bad);
});

test("a pre-release tag is marked as a pre-release and is never the latest", () => {
	const dir = project("2.0.0-rc.1", { tags: ["v1.2.3"] });
	const out = JSON.parse(run(dir, ["--tag", "v2.0.0-rc.1", "--json"]).text);
	assert.equal(out.prerelease, true);
	assert.equal(out.latest, false);
});

test("latest is true only for the highest release tag", () => {
	const tags = ["v0.5.1", "v0.5.2", "v0.5.3"];
	assert.equal(JSON.parse(run(project("0.5.3", { tags }), ["--tag", "v0.5.3", "--json"]).text).latest, true, "the highest");
	assert.equal(JSON.parse(run(project("0.5.1", { tags }), ["--tag", "v0.5.1", "--json"]).text).latest, false, "an older one");
	assert.equal(JSON.parse(run(project("0.5.3", { tags: ["v0.5.1"] }), ["--tag", "v0.5.3", "--json"]).text).latest, true, "its own tag not made yet still counts");
	assert.equal(JSON.parse(run(project("0.10.0", { tags: ["v0.9.0", "v0.2.0"] }), ["--tag", "v0.10.0", "--json"]).text).latest, true, "numbers, not text: 0.10.0 is above 0.9.0");
	assert.equal(JSON.parse(run(project("1.0.0", { tags: ["v1.1.0-rc.1", "v0.9.0"] }), ["--tag", "v1.0.0", "--json"]).text).latest, true, "a pre-release tag does not outrank a release");
});

test("--github-output appends title, version, prerelease, and latest for the workflow", () => {
	const dir = project();
	const file = path.join(dir, "gh-output.txt");
	fs.writeFileSync(file, "earlier=1\n");
	assert.equal(run(dir, ["--tag", "v1.2.3", "--github-output", file]).code, 0);
	const lines = fs.readFileSync(file, "utf8").trim().split("\n");
	assert.deepEqual(lines, ["earlier=1", "title=Stack Agent 1.2.3", "version=1.2.3", "prerelease=false", "latest=true"]);
});

test("--ref reads the files as they were at a tag, not as they are now", () => {
	const dir = project("1.2.3");
	git(dir, "tag", "v1.2.3");
	write(dir, ".claude-plugin/plugin.json", JSON.stringify({ name: "widget", version: "9.9.9" }));
	assert.equal(run(dir, ["--tag", "v1.2.3"]).code, 1, "the working tree disagrees now");
	const r = run(dir, ["--tag", "v1.2.3", "--ref", "v1.2.3"]);
	assert.equal(r.code, 0, r.text);
});

test("without --repo the repository comes from GITHUB_REPOSITORY, then from the origin remote", () => {
	const dir = project();
	assert.throws(() => main(["--root", dir, "--tag", "v1.2.3"], {}), /--repo/);
	const viaEnv = main(["--root", dir, "--tag", "v1.2.3", "--json"], { GITHUB_REPOSITORY: "Env/Repo" });
	assert.match(JSON.parse(viaEnv.text).notes, /github\.com\/Env\/Repo\/blob\/v1\.2\.3/);
	git(dir, "remote", "add", "origin", "https://github.com/Remote/Name.git");
	const viaRemote = main(["--root", dir, "--tag", "v1.2.3", "--json"], {});
	assert.match(JSON.parse(viaRemote.text).notes, /github\.com\/Remote\/Name\/blob/);
});

test("semverCompare orders numbers, and a pre-release below its release", () => {
	assert.ok(semverCompare("0.10.0", "0.9.0") > 0);
	assert.ok(semverCompare("1.0.0", "1.0.0-rc.1") > 0);
	assert.ok(semverCompare("1.0.0-rc.2", "1.0.0-rc.10") < 0);
	assert.equal(semverCompare("1.2.3", "1.2.3"), 0);
});

test("this repository's own version files and changelogs pass, so the next release is not refused for a slip", () => {
	const version = JSON.parse(fs.readFileSync(path.join(repoRoot, ".claude-plugin/plugin.json"), "utf8")).version;
	const r = main(["--root", repoRoot, "--repo", "Brown248/Stack_Agent", "--tag", `v${version}`, "--json"]);
	assert.equal(r.code, 0, r.text);
	assert.match(JSON.parse(r.text).notes, /CHANGELOG\.th\.md/);
});

// ---- the workflow ----------------------------------------------------------------------------------------------

const workflow = () => fs.readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8").replace(/\r\n/g, "\n");

test("the workflow runs on a pushed version tag and by hand (a dry run unless told otherwise), and checks release prep in a pull request", () => {
	const text = workflow();
	assert.match(text, /^ {2}push:\n {4}tags: \["v\*\.\*\.\*"\]/m, "a pushed version tag");
	assert.match(text, /^ {2}workflow_dispatch:\n {4}inputs:\n {6}tag:/m, "by hand, with a tag");
	assert.match(text, /dry_run:\n(?: {8}.*\n)*? {8}default: true/, "a dry run by default");
	assert.match(text, /^ {2}pull_request:\n {4}paths:/m, "release prep is checked in pull requests");
});

test("only the publish job can write, only after the read-only check job, and nothing else is granted", () => {
	const text = workflow();
	assert.match(text, /^permissions:\n {2}contents: read$/m, "read-only at the top");
	assert.equal(text.match(/contents: write/g).length, 1, "write is granted once");
	const [, check, publish] = /\n {2}check:\n([\s\S]*?)\n {2}publish:\n([\s\S]*)$/.exec(text);
	assert.doesNotMatch(check, /permissions:/, "the check job keeps the read-only default, for pull requests too");
	assert.match(publish, /^ {4}permissions:\n {6}contents: write$/m, "write in the publish job");
	assert.match(publish, /^ {4}needs: check$/m, "publish waits for the check");
	assert.doesNotMatch(text, /secrets\./, "no secret");
	assert.doesNotMatch(text, /pull_request_target/, "never the pull_request_target event");
	assert.doesNotMatch(check, /gh release (create|edit)/, "the check job publishes nothing");
});

test("the tag reaches the shell through an environment variable, never pasted into the script", () => {
	const text = workflow();
	const runs = [...text.matchAll(/^ {8}run: (?:\|\n((?: {10}.*\n)+)|(.*)\n)/gm)].map((m) => m[1] ?? m[2]);
	assert.ok(runs.length >= 3, "has run steps");
	for (const r of runs) assert.doesNotMatch(r, /\$\{\{/, `no expression inside a script: ${r}`);
	assert.match(text, /TAG: \$\{\{ inputs\.tag \|\| github\.ref_name \}\}/);
});

test("the workflow publishes only for a pushed tag or a manual run that is not a dry run, with --verify-tag", () => {
	const text = workflow();
	assert.match(text, /if: github\.event_name == 'push' \|\| \(github\.event_name == 'workflow_dispatch' && inputs\.dry_run == false\)/);
	assert.match(text, /gh release create .*--verify-tag/);
	assert.match(text, /gh release edit/, "a release that exists is updated, not an error");
	assert.match(text, /--latest=\$\{\{|--latest="\$LATEST"|LATEST/, "the latest flag comes from the script's answer");
});
