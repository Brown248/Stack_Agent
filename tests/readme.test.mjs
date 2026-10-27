// The README is the first thing an adopter follows, so a dead link or a mistyped flag in it costs more than one in the
// docs. It comes in English and Thai; this keeps the two the same shape and every command and link in them real.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { vendoredFiles } from "../scripts/init.mjs";
import { repoRoot } from "./helpers.mjs";

const FILES = ["README.md", "README.th.md"];
const read = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8").replace(/\r\n/g, "\n");

// the lines outside code fences, so a `#` comment in a code block is not read as a heading
function prose(text) {
	let fenced = false;
	return text.split("\n").filter((line) => {
		if (/^\s*```/.test(line)) {
			fenced = !fenced;
			return false;
		}
		return !fenced;
	});
}
const headings = (text) => prose(text).filter((l) => /^#{1,3} /.test(l));
const codeLines = (text) => {
	let fenced = false;
	const out = [];
	for (const line of text.split("\n")) {
		if (/^\s*```/.test(line)) fenced = !fenced;
		else if (fenced) out.push(line);
	}
	return out;
};
// GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens
const slug = (heading) => heading.replace(/^#+\s+/, "").toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "").trim().replace(/\s/g, "-");

test("the English and Thai READMEs have the same headings in the same order, and link to each other", () => {
	const [en, th] = FILES.map(read);
	assert.equal(headings(th).length, headings(en).length, "the same number of headings");
	assert.deepEqual(
		headings(th).map((h) => h.match(/^#+/)[0]),
		headings(en).map((h) => h.match(/^#+/)[0]),
		"the same levels in the same order",
	);
	assert.ok(en.includes("(README.th.md)"), "English links to Thai");
	assert.ok(th.includes("(README.md)"), "Thai links to English");
	const fences = (t) => t.split("\n").filter((l) => /^\s*```/.test(l)).length;
	assert.equal(fences(th), fences(en), "the same number of code blocks");
});

for (const file of FILES) {
	test(`${file}: every relative link goes to a file that exists, and every #anchor to a heading`, () => {
		const text = read(file);
		const anchors = new Set(headings(text).map(slug));
		const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
		assert.ok(links.length > 10, "has links to check");
		for (const link of links) {
			if (/^https?:/.test(link)) continue;
			if (link.startsWith("#")) assert.ok(anchors.has(link.slice(1)), `${file}: no heading for ${link}`);
			else assert.ok(fs.existsSync(path.join(repoRoot, link.split("#")[0])), `${file}: ${link} does not exist`);
		}
	});

	test(`${file}: every tool and flag in a command is real`, () => {
		const vendored = new Set(vendoredFiles().map(([name]) => name));
		const text = read(file);
		// code blocks, and the `inline code` of the tables and sentences
		const lines = [...codeLines(text), ...prose(text).flatMap((l) => [...l.matchAll(/`([^`]+)`/g)].map((m) => m[1]))];
		let commands = 0;
		for (const line of lines) {
			for (const m of line.matchAll(/\.stack-agent\/bin\/([\w/.-]+\.mjs)((?: [^\n]*)?)/g)) {
				commands++;
				assert.ok(vendored.has(m[1]), `${file}: ${m[1]} is not a tool init vendors`);
				const source = fs.readFileSync(path.join(repoRoot, "scripts", m[1]), "utf8");
				for (const flag of m[2].matchAll(/ --([a-z][\w-]*)/g)) assert.ok(source.includes(`"${flag[1]}"`) || source.includes(`--${flag[1]}`), `${file}: ${m[1]} has no --${flag[1]}`);
			}
			for (const m of line.matchAll(/scripts\/([\w-]+\.mjs)((?: [^\n]*)?)/g)) {
				assert.ok(fs.existsSync(path.join(repoRoot, "scripts", m[1])), `${file}: scripts/${m[1]} does not exist`);
				const source = fs.readFileSync(path.join(repoRoot, "scripts", m[1]), "utf8");
				for (const flag of m[2].matchAll(/ --([a-z][\w-]*)/g)) assert.ok(source.includes(`"${flag[1]}"`) || source.includes(`--${flag[1]}`), `${file}: ${m[1]} has no --${flag[1]}`);
			}
		}
		assert.ok(commands >= 6, "the commands table and steps are checked");
	});
}

test("the verify.json and guard rule in the README are valid, and the verify.json loads", async () => {
	const { loadVerifyConfig } = await import("../scripts/verify.mjs");
	const { loadConfig } = await import("../scripts/guard.mjs");
	const { tempDir, write } = await import("./helpers.mjs");
	for (const file of FILES) {
		const blocks = [];
		let current = null;
		for (const line of read(file).split("\n")) {
			if (/^\s*```json/.test(line)) current = [];
			else if (current && /^\s*```/.test(line)) (blocks.push(current.join("\n")), (current = null));
			else if (current) current.push(line);
		}
		assert.equal(blocks.length, 2, `${file}: a verify.json and a guard rule`);
		const dir = tempDir("stack-agent-readme-");
		const [verify, rule] = blocks.map((b) => JSON.parse(b));
		write(dir, ".stack-agent/verify.json", JSON.stringify(verify));
		assert.doesNotThrow(() => loadVerifyConfig(path.join(dir, ".stack-agent/verify.json")), `${file}: verify.json`);
		write(dir, ".stack-agent/guard.config.json", JSON.stringify({ baseline: ".stack-agent/guard-baseline.json", ignore: [], rules: [rule] }));
		assert.doesNotThrow(() => loadConfig(path.join(dir, ".stack-agent/guard.config.json")), `${file}: guard rule`);
		assert.equal(verify.checks[0].expectExit, 0);
	}
});
