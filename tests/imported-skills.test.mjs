// The 31 skills copied from mattpocock/skills (see THIRD_PARTY_NOTICES.md) must stay what the notice and the guide say they
// are: listed, present, started the way the guide says, and not broken by a rename or a flip of one of them.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { repoRoot } from "./helpers.mjs";

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
const skillsDir = path.join(repoRoot, "skills");
const frontOf = (name) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(read(`skills/${name}/SKILL.md`))?.[1] ?? "";
const typedOnly = (name) => /^disable-model-invocation: true\s*$/m.test(frontOf(name));
const names = (text) => [...text.matchAll(/`([a-z][a-z0-9-]+)`/g)].map((m) => m[1]);

const notice = read("THIRD_PARTY_NOTICES.md");
const group = (label) => names(new RegExp(`- \\*\\*${label}:\\*\\* (.*)`).exec(notice)?.[1] ?? "");
const IMPORTED = [...group("engineering"), ...group("productivity"), ...group("misc")];
const REWRITTEN = group("rewritten");
const EDITED = group("edited");
const OWN = names(/Stack Agent's own skills \(([^)]*)\)/.exec(notice)?.[1] ?? "");
const folders = fs.readdirSync(skillsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

// started only by typing: changes the machine or the repository, or overlaps Stack Agent's debug
const RISKY = ["git-guardrails", "setup-pre-commit", "step-script", "scaffold-exercises", "migrate-to-shoehorn"];

test("the notice lists every skill that is not Stack Agent's own, and the license of the author", () => {
	assert.ok(IMPORTED.length >= 20, "the derived skills are listed");
	assert.equal(new Set(IMPORTED).size, IMPORTED.length, "no name twice");
	assert.equal(OWN.length, 12);
	// each derived skill says how far it has moved from upstream, once
	assert.deepEqual([...REWRITTEN, ...EDITED].sort(), [...IMPORTED].sort(), "rewritten and edited together are exactly the derived skills");
	assert.equal(new Set([...REWRITTEN, ...EDITED]).size, IMPORTED.length, "no skill in both lists");
	assert.deepEqual([...folders].sort(), [...IMPORTED, ...OWN].sort(), "skills/ holds exactly the listed skills");
	for (const n of IMPORTED) assert.ok(fs.existsSync(path.join(skillsDir, n, "SKILL.md")), n);
	assert.match(notice, /Copyright \(c\) 2026 Matt Pocock/);
	assert.match(notice, /Permission is hereby granted, free of charge/);
});

test("the skills that install packages, change hooks or settings, touch .env, or overlap debug cannot be started by the model", () => {
	for (const n of RISKY) assert.ok(typedOnly(n), `${n} must set disable-model-invocation: true`);
	// the notice says which ones, so a copy of newer upstream text knows to carry the line over
	for (const n of RISKY) assert.ok(notice.includes(`\`${n}\``), `${n} is named in the notice`);
});

test("every skill that another skill starts through the Skill tool exists and is one the model may start", () => {
	let found = 0;
	for (const n of IMPORTED) {
		const dir = path.join(skillsDir, n);
		const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
		for (const f of files) {
			for (const m of fs.readFileSync(path.join(dir, f), "utf8").matchAll(/Skill tool[^.\n]*/g)) {
				for (const q of m[0].matchAll(/["`]([a-z][a-z0-9-]+)["`]/g)) {
					if (q[1] === "Skill" || q[1] === "name") continue;
					found++;
					assert.ok(folders.includes(q[1]), `${n}/${f} starts "${q[1]}", which is not in skills/`);
					assert.ok(!typedOnly(q[1]), `${n}/${f} starts "${q[1]}" through the Skill tool, but the model cannot start it`);
				}
			}
		}
	}
	assert.ok(found >= 8, `only ${found} references found; the pattern has stopped matching`);
});

test("the guide says, for each derived skill, whether Claude starts it or the person types it, as the front matter does", () => {
	for (const [file, asked, typed] of [["docs/engineering-skills.md", "asked", "typed"], ["docs/th/engineering-skills.md", "ขอ", "พิมพ์"]]) {
		const rows = new Map([...read(file).matchAll(/^\| `([a-z][a-z0-9-]+)` \| (\S+) \|/gm)].map((m) => [m[1], m[2]]));
		for (const n of IMPORTED) {
			assert.ok(rows.has(n), `${file} has no row for ${n}`);
			assert.equal(rows.get(n), typedOnly(n) ? typed : asked, `${file}: ${n}`);
		}
	}
	// the guide's counts
	const en = read("docs/engineering-skills.md");
	const askedCount = IMPORTED.filter((n) => !typedOnly(n)).length;
	assert.match(en, new RegExp(`${askedCount} of the ${IMPORTED.length} are listed to Claude`));
	assert.match(en, new RegExp(`The other ${IMPORTED.length - askedCount} start only when you type`));
});
