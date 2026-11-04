// The lines the command-line tools (verify, guard, feature-map, api-map, init) print for a person: the verdicts and the
// labels around them, in English or in plain Thai. Vendored with the tools into .stack-agent/bin/lib, so CI and an
// agent that runs them from there behave the same as the plugin's copy.
//
// Thai is used only when all three hold: the project asked for it ("language": "th" in .stack-agent/verify.json, or
// STACK_AGENT_LANG=th), the output goes to a terminal, and the caller did not turn it off. An agent that runs a tool
// through a shell reads a pipe, not a terminal, so it keeps the English text it was always given (Thai costs it about
// twice the tokens); CI logs stay English for the same reason. What a project's own rules, checks, and tests print
// (a guard rule's message, a failing test's output) is the project's text and is never translated. --json output is
// data and never translated.
//
// The English entries are the original wording, word for word.

import fs from "node:fs";
import path from "node:path";
import { languageFor } from "./messages.mjs";

export const CLI_TEXT = {
	en: {
		"verify.pass": "verify: ok, evidence {file}{scope}",
		"verify.fail": "verify: FAIL, evidence {file}{scope}",
		"verify.partial": " (partial run: {flags}; run with no flags before calling the change done)",
		"doctor.problem": "problem: {text}",
		"doctor.note": "note: {text}",
		"doctor.ready": "doctor: ready, nothing here blocks verify",
		"doctor.notready": "doctor: NOT ready ({n} problem(s))",
		"guard.violation": "{file}:{line}  [{rule}] {message}\n    found: {detail}\n    fix:   {fix}",
		"guard.refuse": "refusing to raise the baseline (needs a human-approved --allow-increase):\n{lines}",
		"guard.fail.over": "guard: FAIL ({n} rule/file pair(s) over baseline)",
		"guard.fail.loosened": "guard: FAIL (guard config or baseline loosened compared with {ref}; needs human review)",
		"guard.ok": "guard: ok ({n} known violation(s) within baseline)",
		"map.warning": "  warning: {text}",
		"map.suggestion": "  suggestion: {text}",
		"feature.drift": "feature-map: DRIFT ({n} problem(s))",
		"feature.ok": "feature-map: ok ({features} feature(s), {covered} covered by verify checks{tail})",
		"feature.tail": ", {cases} case(s), {casesCovered} covered by checks",
		"api.drift": "api-map: DRIFT ({n} problem(s))",
		"api.ok": "api-map: ok ({routes} route(s) mapped, {covered} covered by verify checks)",
		"init.complete": "\nsetup complete in {target}",
		"init.unfinished": "\nsetup unfinished in {target}:\n{list}",
		"init.notes": "\nnotes (do not affect the exit code):",
		"init.proof.never": "setup is not proven yet: verify has never run here, so a wrong command or a missing program can still be hiding; {run}",
		"init.proof.failed": "setup is not proven yet: the latest verify run failed ({file}); {run}",
		"init.proof.partial": "setup is not proven yet: the latest verify run was partial (skipped tests or checks); {run}",
		"init.proof.run": "run node .stack-agent/bin/verify.mjs once with no flags, and fix the config until it passes",
	},
	th: {
		"verify.pass": "verify: ผ่านหมด หลักฐานอยู่ที่ {file}{scope}",
		"verify.fail": "verify: ไม่ผ่าน ดูรายละเอียดข้างบน หลักฐานอยู่ที่ {file}{scope}",
		"verify.partial": " (รันแค่บางส่วน: {flags} ก่อนบอกว่าเสร็จ ให้รันเต็มโดยไม่ใส่ flag)",
		"doctor.problem": "ปัญหา: {text}",
		"doctor.note": "หมายเหตุ: {text}",
		"doctor.ready": "doctor: พร้อมแล้ว ไม่มีอะไรขวาง verify",
		"doctor.notready": "doctor: ยังไม่พร้อม (มี {n} ข้อ)",
		"guard.violation": "{file}:{line}  [{rule}] {message}\n    พบ:      {detail}\n    วิธีแก้: {fix}",
		"guard.refuse": "ไม่ยอมเพิ่ม baseline (ต้องให้คนอนุมัติด้วย --allow-increase):\n{lines}",
		"guard.fail.over": "guard: ไม่ผ่าน (กฎกับไฟล์ {n} คู่มีมากกว่าที่ baseline ยอมให้)",
		"guard.fail.loosened": "guard: ไม่ผ่าน (config หรือ baseline ของ guard หลวมกว่า {ref} ต้องให้คนตรวจ)",
		"guard.ok": "guard: ผ่าน (มีของเก่า {n} จุด อยู่ในที่ baseline ยอมให้)",
		"map.warning": "  คำเตือน: {text}",
		"map.suggestion": "  ข้อเสนอ: {text}",
		"feature.drift": "feature-map: แผนที่ไม่ตรงกับโค้ด ({n} ข้อ)",
		"feature.ok": "feature-map: ตรงกัน ({features} ฟีเจอร์ มี verify check คลุม {covered}{tail})",
		"feature.tail": " มีเคสย่อย {cases} เคส คลุมด้วย check {casesCovered}",
		"api.drift": "api-map: แผนที่ไม่ตรงกับโค้ด ({n} ข้อ)",
		"api.ok": "api-map: ตรงกัน (แมป {routes} route มี verify check คลุม {covered})",
		"init.complete": "\nตั้งค่าเสร็จแล้วใน {target}",
		"init.unfinished": "\nตั้งค่ายังไม่เสร็จใน {target}:\n{list}",
		"init.notes": "\nหมายเหตุ (ไม่กระทบ exit code):",
		"init.proof.never": "ยังไม่ได้พิสูจน์ว่าตั้งค่าใช้ได้: verify ยังไม่เคยรันที่นี่ จึงอาจมีคำสั่งผิดหรือโปรแกรมที่ขาดซ่อนอยู่ {run}",
		"init.proof.failed": "ยังไม่ได้พิสูจน์ว่าตั้งค่าใช้ได้: verify รอบล่าสุดไม่ผ่าน ({file}) {run}",
		"init.proof.partial": "ยังไม่ได้พิสูจน์ว่าตั้งค่าใช้ได้: verify รอบล่าสุดรันแค่บางส่วน (ข้ามเทสต์หรือ check) {run}",
		"init.proof.run": "รัน node .stack-agent/bin/verify.mjs หนึ่งครั้งโดยไม่ใส่ flag แล้วแก้ config จนผ่าน",
	},
};

// Fills {name} placeholders in one pass, so text that came from outside is never read as a placeholder. A missing
// message or value throws: it is a mistake in the code, and a test finds it.
export function say(lang, key, params = {}) {
	const catalog = CLI_TEXT[lang];
	if (!catalog) throw new Error(`cli-text: no catalog for language ${JSON.stringify(lang)}`);
	if (typeof catalog[key] !== "string") throw new Error(`cli-text: no message ${JSON.stringify(key)} in ${lang}`);
	return catalog[key].replace(/\{(\w+)\}/g, (_, name) => {
		if (!(name in params)) throw new Error(`cli-text: ${key} needs a value for {${name}}`);
		return String(params[name]);
	});
}

// "th" only for a person at a terminal who asked for it; "en" for everything else.
export function cliLang(config, { env = process.env, isTTY = Boolean(process.stdout.isTTY) } = {}) {
	return isTTY && languageFor(config, env) === "th" ? "th" : "en";
}

// the same, for a tool that does not already hold the verify config: it reads "language" from .stack-agent/verify.json
export function projectLang(root, options) {
	let config = null;
	try {
		config = JSON.parse(fs.readFileSync(path.join(root, ".stack-agent/verify.json"), "utf8"));
	} catch {}
	return cliLang(config, options);
}
