// The verdict lines of the command-line tools can be read in plain Thai, but only by a person who asked for it and is at a
// terminal. These tests keep three promises: the English text is the original wording, byte for byte; the two catalogs
// say the same things; and nothing but a terminal plus the setting turns Thai on.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { main as apiMap } from "../scripts/api-map.mjs";
import { main as featureMap } from "../scripts/feature-map.mjs";
import { main as guard } from "../scripts/guard.mjs";
import { main as init, proofNote } from "../scripts/init.mjs";
import { CLI_TEXT, cliLang, projectLang, say } from "../scripts/lib/cli-text.mjs";
import { main as verify } from "../scripts/verify.mjs";
import { copyExample, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const THAI = /[฀-๿]/;
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("both catalogs have the same messages with the same placeholders, and every Thai message is Thai", () => {
	assert.deepEqual(Object.keys(CLI_TEXT.th).sort(), Object.keys(CLI_TEXT.en).sort());
	for (const key of Object.keys(CLI_TEXT.en)) {
		assert.deepEqual(placeholders(CLI_TEXT.th[key]), placeholders(CLI_TEXT.en[key]), `${key}: placeholders differ`);
		assert.match(CLI_TEXT.th[key], THAI, `${key} has no Thai in it`);
		assert.doesNotMatch(CLI_TEXT.en[key], THAI, `${key}: English text holds Thai`);
	}
});

test("say fills every placeholder once, leaves braces in the values alone, and refuses a missing key, language, or value", () => {
	assert.equal(say("en", "guard.ok", { n: "{n}" }), "guard: ok ({n} known violation(s) within baseline)");
	assert.throws(() => say("en", "no.such.key"), /no message/);
	assert.throws(() => say("fr", "guard.ok", { n: 1 }), /no catalog/);
	assert.throws(() => say("th", "guard.ok"), /needs a value for \{n\}/);
});

test("Thai is used only with the setting AND a terminal", () => {
	const th = { language: "th" };
	assert.equal(cliLang(th, { env: {}, isTTY: true }), "th");
	assert.equal(cliLang(th, { env: {}, isTTY: false }), "en", "a pipe (an agent, CI) keeps English");
	assert.equal(cliLang({}, { env: {}, isTTY: true }), "en", "no setting, English");
	assert.equal(cliLang(null, { env: { STACK_AGENT_LANG: "th" }, isTTY: true }), "th");
	assert.equal(cliLang(th, { env: { STACK_AGENT_LANG: "en" }, isTTY: true }), "en", "the environment wins");
	assert.equal(cliLang(th, { env: { STACK_AGENT_LANG: "klingon" }, isTTY: true }), "en", "an unknown value is English");
	const dir = tempDir("stack-agent-lang-");
	write(dir, ".stack-agent/verify.json", JSON.stringify({ language: "th" }));
	assert.equal(projectLang(dir, { env: {}, isTTY: true }), "th");
	assert.equal(projectLang(dir, { env: {}, isTTY: false }), "en");
	assert.equal(projectLang(tempDir("stack-agent-lang-"), { env: {}, isTTY: true }), "en", "no verify.json is English");
	write(dir, ".stack-agent/verify.json", "{not json");
	assert.equal(projectLang(dir, { env: {}, isTTY: true }), "en", "an unreadable config is English, not an error");
});

test("a tool run through a pipe stays English even with the Thai setting, in the plugin's copy and in the vendored copy", () => {
	const dir = copyExample("sample-cli");
	write(dir, ".stack-agent/verify.json", JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dir, ".stack-agent/verify.json"), "utf8")), language: "th" }));
	assert.equal(runNode(path.join(repoRoot, "scripts/init.mjs"), [dir]).code, 0);
	assert.ok(fs.existsSync(path.join(dir, ".stack-agent/bin/lib/cli-text.mjs")) && fs.existsSync(path.join(dir, ".stack-agent/bin/lib/messages.mjs")), "init vendors the two files the tools import");
	for (const tool of [path.join(repoRoot, "scripts/feature-map.mjs"), path.join(dir, ".stack-agent/bin/feature-map.mjs")]) {
		const r = runNode(tool, ["--root", dir], { env: { ...process.env, STACK_AGENT_LANG: "th" } });
		assert.equal(r.code, 0, r.stderr);
		assert.match(r.stdout, /^feature-map: ok \(\d+ feature\(s\), \d+ covered by verify checks/m);
		assert.doesNotMatch(r.stdout + r.stderr, THAI);
	}
	const g = runNode(path.join(dir, ".stack-agent/bin/guard.mjs"), ["--root", dir], { env: { ...process.env, STACK_AGENT_LANG: "th" } });
	assert.match(g.stdout + g.stderr, /^guard: ok \(\d+ known violation\(s\) within baseline\)$/m);
});

test("feature-map in Thai: the verdict, the cases tail, the warning and the suggestion labels; the project's own text stays as written", () => {
	const dir = copyExample("sample-cli");
	const ok = featureMap(["--root", dir], { lang: "th" });
	assert.equal(ok.code, 0);
	assert.match(ok.text, /feature-map: ตรงกัน \(3 ฟีเจอร์ มี verify check คลุม 3 มีเคสย่อย 3 เคส คลุมด้วย check 2\)/);
	assert.match(ok.text, /^ {2}คำเตือน: Show the most common words \/ `--top` left out: no verify check covers this case$/m, "the warning text is built from the project's names, so it stays");
	const mapFile = path.join(dir, ".stack-agent/feature-map.md");
	fs.writeFileSync(mapFile, fs.readFileSync(mapFile, "utf8").replace("wordfreq/core.py#def top_words", "wordfreq/counting.py#def top_words"));
	const drift = featureMap(["--root", dir, "--suggest"], { lang: "th" });
	assert.equal(drift.code, 1);
	assert.match(drift.text, /feature-map: แผนที่ไม่ตรงกับโค้ด \(1 ข้อ\)/);
	assert.equal(featureMap(["--root", dir], { lang: "en" }).code, 1);
});

test("guard in Thai: the verdict lines and the labels on a violation; the rule's own message and fix are the project's words", () => {
	const dir = copyExample("sample-backend");
	const ok = guard(["--root", dir], { lang: "th" });
	assert.match(ok.text, /guard: ผ่าน \(มีของเก่า \d+ จุด อยู่ในที่ baseline ยอมให้\)/);
	write(dir, "src/modules/items/controller.js", `${fs.readFileSync(path.join(dir, "src/modules/items/controller.js"), "utf8")}\nconst q = "SELECT * FROM items";\n`);
	const bad = guard(["--root", dir], { lang: "th" });
	assert.equal(bad.code, 1);
	assert.match(bad.text, /\[no-sql-in-controller\] SQL belongs in the repository layer, not in a controller\n {4}พบ: {6}.*\n {4}วิธีแก้: move the query into/);
	assert.match(bad.text, /guard: ไม่ผ่าน \(กฎกับไฟล์ \d+ คู่มีมากกว่าที่ baseline ยอมให้\)/);
	const en = guard(["--root", dir], { lang: "en" });
	assert.match(en.text, /\n {4}found: .*\n {4}fix: {3}move the query into/);
	assert.match(en.text, /guard: FAIL \(\d+ rule\/file pair\(s\) over baseline\)/);
});

test("api-map in Thai", () => {
	const dir = copyExample("sample-backend");
	const r = apiMap(["--root", dir], { lang: "th" });
	assert.match(r.text, /api-map: (ตรงกัน \(แมป \d+ route มี verify check คลุม \d+\)|แผนที่ไม่ตรงกับโค้ด \(\d+ ข้อ\))/);
	assert.match(apiMap(["--root", dir], { lang: "en" }).text, /api-map: (ok \(\d+ route\(s\) mapped, \d+ covered by verify checks\)|DRIFT \(\d+ problem\(s\)\))/);
});

test("verify in Thai: the closing line, the partial-run note, and the doctor lines; --json is never translated", async () => {
	const dir = tempDir("stack-agent-th-verify-");
	write(dir, ".stack-agent/verify.json", JSON.stringify({ against: false, checks: [{ name: "node-runs", args: [process.execPath, "-v"], expectOutputMatches: "^v\\d+" }] }));
	const full = await verify(["--root", dir], { lang: "th" });
	assert.equal(full.code, 0, full.text);
	assert.match(full.text, /verify: ผ่านหมด หลักฐานอยู่ที่ /);
	const partial = await verify(["--root", dir, "--check", "node-runs"], { lang: "th" });
	assert.match(partial.text, /\(รันแค่บางส่วน: --check/);
	assert.match((await verify(["--root", dir, "--check", "node-runs"], { lang: "en" })).text, /\(partial run: --check; run with no flags before calling the change done\)/);
	assert.match((await verify(["--root", dir, "--doctor"], { lang: "th" })).text, /doctor: พร้อมแล้ว ไม่มีอะไรขวาง verify/);
	write(dir, ".stack-agent/verify.json", JSON.stringify({ against: false, test: { command: "no-such-program-xyz" } }));
	const bad = await verify(["--root", dir, "--doctor"], { lang: "th" });
	assert.equal(bad.code, 2);
	assert.match(bad.text, /ปัญหา: test: no-such-program-xyz was not found/);
	assert.match(bad.text, /doctor: ยังไม่พร้อม \(มี 1 ข้อ\)/);
	const json = await verify(["--root", dir, "--doctor", "--json"], { lang: "th" });
	assert.deepEqual(Object.keys(JSON.parse(json.text)), ["ready", "problems", "notes"]);
	assert.doesNotMatch(json.text, THAI);
});

test("init in Thai: the setup verdict, the notes heading, and the not-proven-yet line", () => {
	const dir = copyExample("sample-cli");
	runNode(path.join(repoRoot, "scripts/init.mjs"), [dir]);
	const r = init([dir, "--check"], { lang: "th" });
	assert.match(r.text, /ตั้งค่า(เสร็จแล้ว|ยังไม่เสร็จ)ใน /);
	assert.match(r.text, /ยังไม่ได้พิสูจน์ว่าตั้งค่าใช้ได้: verify ยังไม่เคยรันที่นี่ .* รัน node \.stack-agent\/bin\/verify\.mjs หนึ่งครั้งโดยไม่ใส่ flag แล้วแก้ config จนผ่าน/);
	assert.match(proofNote(dir, "en"), /^setup is not proven yet: verify has never run here/);
	write(dir, ".stack-agent/evidence/latest.json", JSON.stringify({ ok: false, full: true }));
	assert.match(proofNote(dir, "th"), /verify รอบล่าสุดไม่ผ่าน \(\.stack-agent\/evidence\/latest\.json\)/);
	assert.match(init([dir, "--check"], { lang: "en" }).text, /^setup (complete|unfinished) in /m);
});
