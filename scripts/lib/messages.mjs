// The messages the hooks show a human, in English or in plain Thai. Only text meant for a person lives here: what
// the agent is told when it is blocked stays English, and so does everything written to evidence files, because
// nothing may depend on which language was chosen. The language is "th" when STACK_AGENT_LANG or "language" in
// .stack-agent/verify.json says so, and English otherwise (an unknown value is English, since a hook must not fail
// over a display setting). The English text is the original wording, unchanged. Not vendored: the hooks run it from
// the plugin, so a project needs no `init` rerun for a change here.

export const LANGUAGES = ["en", "th"];

export function languageFor(config, env = process.env) {
	for (const value of [env?.STACK_AGENT_LANG, config?.language]) {
		if (typeof value !== "string" || !value.trim()) continue;
		const lang = value.trim().toLowerCase();
		return LANGUAGES.includes(lang) ? lang : "en";
	}
	return "en";
}

export const MESSAGES = {
	en: {
		"tools.differ":
			"stack-agent: the tools in .stack-agent/bin (version {vendored}) differ from this plugin's copy (version {plugin}): {shown}. " +
			"The hooks run the plugin's copy and CI runs .stack-agent/bin, so they can judge the same code differently. " +
			"Refresh them with `node \"{initScript}\" \"{root}\"` (it rewrites only the tools) and commit the result.",
		"release.guard": "stack-agent: stopping with guard violations after {max} reminders: {list}. Fix them before trusting this change; CI will fail on them.",
		"release.unverified": "stack-agent: stopping with unverified changes after {max} reminders ({list}). Run node .stack-agent/bin/verify.mjs before trusting this change.",
		"release.skip.message": 'stack-agent: the agent stopped without verifying and said why in its final message: "{reason}"',
		"release.skip.file": 'stack-agent: the agent stopped without verifying and recorded why in {file}: "{reason}"',
		// the Stop hook's reminders to the agent (Thai only once measured: AGENT_THAI)
		"remind.main": "stack-agent: code changed but {why} ({list}). Before you finish, {run} the full verification (`node .stack-agent/bin/verify.mjs` with no flags, see the verify skill) and report its evidence file, or say plainly why it cannot run here. {ending}",
		"remind.run": "run",
		"remind.addcheck": "{verify} has no new check in this change set. If the change adds or changes behavior a user can see, first add a check for it there (the success case and at least one rejection case), so the evidence covers the new behavior and not only the old checks. If nothing a user can see changed, say so. Then run",
		"remind.ending.block": 'If verification truly cannot run here, record why with `node .stack-agent/bin/verify.mjs --skip "<reason>"`, or, if you cannot run commands at all, end your final message with the line `{marker} <reason>`; if the user asked you not to verify, say so in the reason, and tell the user the change is unverified. (Stop {attempt} of {max}: stopping stays blocked until the evidence matches the code.)\n',
		"remind.ending.once": "This reminder fires once per change set.\n",
		"guard.block": "stack-agent: the guard fails on files changed in this session (the after-edit and after-shell hooks report a violation once, so one left unfixed gets here). Fix the code, following each fix line; never raise the baseline to get past it:\n{list}{more}\nThen run the full verification again. (Stop {attempt} of {max}.)\n",
		"guard.more": "\n  ... and {n} more (run node .stack-agent/bin/guard.mjs)",
		"coverage.main": "stack-agent: verification passed, but no check or test is new or changed while the code is{list}, so nothing shows that your change is tested: the against step had nothing to run on the code before it. If the change adds or changes behavior, add a test, or a check to {verify}, that fails without it (the success case and one rejection case), then run `node .stack-agent/bin/verify.mjs` again. If nothing a user can observe changed (a refactor, a rename), say so in your final message and stop; this is asked once.\n",
		"import.main": "stack-agent: verification passed, but its against step could not show that your change is tested: the changed tests import something the code before the change does not have{listed}, so on that code they fail before testing anything. Add a check to {verify} that fails without your change. If the program already runs the new code, run it the way a user does (a command or an HTTP request on an input that reaches it). If nothing calls the new code yet, call it directly with a command check, for example `\"args\": [\"node\", \"--input-type=module\", \"-e\", \"import { {name} } from './src/<module>.js'; console.log(JSON.stringify({name}(<input>)))\"]` or `\"args\": [\"python\", \"-c\", \"from <module> import {name}; print({name}(<input>))\"]`, with `expectOutputIncludes` set to the result you expect: on the code before your change it fails, and that is the proof. Then run `node .stack-agent/bin/verify.mjs` again. Only if the new code cannot be called at all, say why and stop; this is asked once.\n",
		// asked of a human in the permission prompt (PreToolUse "ask": Claude Code shows the reason to the person)
		"ask.force-push": "force-push rewrites shared history and cannot be undone for others. A human must approve it.",
		"ask.push-delete": "this push deletes a remote branch or tag. A human must approve it.",
		"ask.reset-hard": "`git reset --hard` discards uncommitted work permanently. A human must approve it.",
		"ask.clean": "`git clean -f` deletes untracked files permanently. A human must approve it.",
		"ask.discard-all": "this discards local changes to every file permanently. A human must approve it.",
		"ask.branch-delete": "`git branch -D` deletes a branch even when its commits are not merged anywhere, which can lose work. A human must approve it.",
		"ask.branch-force-move": "`git {sub}` with a force flag points an existing branch at other commits; its old commits are then reachable only through the reflog. A human must approve it.",
		"ask.stash-drop": "this deletes stashed work permanently. A human must approve it.",
		"ask.allow-increase": "`--allow-increase` raises the guard baseline and accepts new rule violations. A human must approve it.",
		"ask.git-hooks": "this changes the repo's local git hooks (.git/hooks). They are the gate that runs the guard before a commit, and a change there is in no diff. A human must approve it.",
		"ask.workflows-delete": "this deletes the folder holding the Stack Agent CI workflow, the check that still holds when the hooks do not. A human must approve it.",
		"ask.evidence": 'this writes {what} by hand. Only verify.mjs writes it (run it, or use verify.mjs --skip "<reason>"), so a hand-written one would claim a verification that did not happen; a human must approve it.',
		"ask.protected": "this changes {what}. That controls what the guard enforces, and loosening it is how a rule gets bypassed, so a human must approve it. To fix a violation, change the code instead.{setup}",
		"ask.setup-hint": " If you are filling in the template init just wrote (it still has EDIT ME and is not committed), use the Edit or Write tool instead: those do not ask for it.",
		// what the ask messages are about
		"what.the guard rules": "the guard rules",
		"what.the guard baseline": "the guard baseline",
		"what.the vendored Stack Agent tools": "the vendored Stack Agent tools",
		"what.the Stack Agent CI workflow": "the Stack Agent CI workflow",
		"what.the verify evidence": "the verify evidence",
		"what.the verify skip record": "the verify skip record",
		"what.the Stop hook's session record": "the Stop hook's session record",
		"what.the Stack Agent folder and its evidence": "the Stack Agent folder and its evidence",
		"what.the shared guard rules (a file guard.config.json extends)": "the shared guard rules (a file guard.config.json extends)",
		"what.the repo's local git hooks (.git/hooks)": "the repo's local git hooks (.git/hooks)",
		// denied: the reason is shown to the agent, so these stay English until a Thai version is measured (AGENT_THAI)
		"deny.hookspath-override": "blocked: overriding core.hooksPath turns off the repo's git hooks and guard. Fix what the hook reports instead.",
		"deny.alias-skips": "blocked: this git alias commits or pushes without the repo's git hooks, which skips the guard and checks. Fix what the hook reports instead.",
		"deny.hookspath-config": "blocked: setting core.hooksPath turns off the repo's git hooks and guard. Fix what the hook reports instead.",
		"deny.env-hooks": "blocked: `{env}` turns off the repo's git hooks for this `git {sub}`. Fix what the hook reports instead.",
		"deny.no-verify": "blocked: `git {sub} --no-verify` skips the repo's guard and checks. Fix what the hook reports instead.",
		"deny.commit-n": "blocked: `git commit -n` is --no-verify and skips the repo's guard and checks. Fix what the hook reports instead.",
		"deny.hookspath-gitconfig-env": "blocked: setting core.hooksPath through GIT_CONFIG_* turns off the repo's git hooks and guard. Fix what the hook reports instead.",
		"deny.export-env": "blocked: `{env}` turns off the repo's git hooks for every later command. Fix what the hook reports instead.",
	},
	th: {
		"tools.differ":
			"stack-agent: เครื่องมือใน .stack-agent/bin (เวอร์ชัน {vendored}) ไม่ตรงกับของปลั๊กอิน (เวอร์ชัน {plugin}): {shown}. " +
			"hook ใช้ของปลั๊กอิน แต่ CI ใช้ของใน .stack-agent/bin สองฝั่งเลยอาจตัดสินโค้ดเดียวกันไม่เหมือนกัน. " +
			"อัปเดตด้วย `node \"{initScript}\" \"{root}\"` (มันเขียนทับแค่เครื่องมือ) แล้ว commit ผลที่ได้",
		"release.guard": "stack-agent: agent หยุดทั้งที่ยังมีกฎที่ฝ่าฝืนอยู่ หลังเตือนไปแล้ว {max} ครั้ง: {list}. แก้ก่อนค่อยเชื่อการเปลี่ยนแปลงนี้ เพราะ CI จะไม่ผ่าน",
		"release.unverified": "stack-agent: agent หยุดทั้งที่ยังมีการเปลี่ยนแปลงที่ไม่ได้ตรวจ หลังเตือนไปแล้ว {max} ครั้ง ({list}). รัน node .stack-agent/bin/verify.mjs ก่อนค่อยเชื่อการเปลี่ยนแปลงนี้",
		"release.skip.message": 'stack-agent: agent หยุดโดยไม่ได้ตรวจ และบอกเหตุผลไว้ในข้อความสุดท้าย: "{reason}"',
		"release.skip.file": 'stack-agent: agent หยุดโดยไม่ได้ตรวจ และจดเหตุผลไว้ใน {file}: "{reason}"',
		"remind.main": "stack-agent: โค้ดเปลี่ยนแต่ {why} ({list}). ก่อนจบงาน {run}การตรวจแบบเต็ม (`node .stack-agent/bin/verify.mjs` ไม่ใส่แฟลก ดู verify skill) แล้วรายงานไฟล์หลักฐาน หรือบอกตรงๆ ว่าทำไมรันที่นี่ไม่ได้ {ending}",
		"remind.run": "ให้รัน",
		"remind.addcheck": "{verify} ยังไม่มี check ใหม่ในชุดการแก้นี้ ถ้าการแก้เพิ่มหรือเปลี่ยนพฤติกรรมที่ผู้ใช้เห็นได้ ให้เพิ่ม check ของมันที่นั่นก่อน (กรณีสำเร็จ และกรณีถูกปฏิเสธอย่างน้อยหนึ่งกรณี) หลักฐานจะได้ครอบคลุมพฤติกรรมใหม่ ไม่ใช่แค่ check เก่า ถ้าไม่มีอะไรที่ผู้ใช้เห็นเปลี่ยน ให้บอกว่าอย่างนั้น จากนั้นให้รัน",
		"remind.ending.block": 'ถ้าตรวจที่นี่ไม่ได้จริงๆ ให้จดเหตุผลด้วย `node .stack-agent/bin/verify.mjs --skip "<reason>"` หรือถ้ารันคำสั่งไม่ได้เลย ให้จบข้อความสุดท้ายด้วยบรรทัด `{marker} <reason>` ถ้าผู้ใช้สั่งไม่ให้ตรวจ ให้บอกในเหตุผล และบอกผู้ใช้ว่าการแก้นี้ยังไม่ได้ตรวจ (Stop {attempt} จาก {max}: จะหยุดไม่ได้จนกว่าหลักฐานจะตรงกับโค้ด)\n',
		"remind.ending.once": "คำเตือนนี้ขึ้นครั้งเดียวต่อชุดการแก้\n",
		"guard.block": "stack-agent: guard ไม่ผ่านกับไฟล์ที่แก้ใน session นี้ (hook หลังแก้ไฟล์และหลังรัน shell รายงานการฝ่าฝืนแค่ครั้งเดียว อันที่ยังไม่แก้จึงมาถึงตรงนี้) ให้แก้ที่โค้ดตามบรรทัด fix ของแต่ละอัน ห้ามยก baseline เพื่อให้ผ่าน:\n{list}{more}\nจากนั้นรันการตรวจแบบเต็มอีกครั้ง (Stop {attempt} จาก {max})\n",
		"guard.more": "\n  ... และอีก {n} รายการ (รัน node .stack-agent/bin/guard.mjs)",
		"coverage.main": "stack-agent: verification ผ่าน แต่ไม่มี check หรือเทสต์ใหม่หรือที่เปลี่ยนเลย ทั้งที่โค้ดเปลี่ยน{list} จึงไม่มีอะไรแสดงว่าการแก้ของคุณถูกทดสอบ: ขั้น against ไม่มีอะไรให้รันกับโค้ดก่อนแก้ ถ้าการแก้เพิ่มหรือเปลี่ยนพฤติกรรม ให้เพิ่มเทสต์ หรือ check ใน {verify} ที่ล้มเมื่อไม่มีการแก้นั้น (กรณีสำเร็จและกรณีถูกปฏิเสธหนึ่งกรณี) แล้วรัน `node .stack-agent/bin/verify.mjs` อีกครั้ง ถ้าไม่มีอะไรที่ผู้ใช้สังเกตได้เปลี่ยน (เช่น refactor หรือเปลี่ยนชื่อ) ให้บอกในข้อความสุดท้ายแล้วหยุด เรื่องนี้ถามครั้งเดียว\n",
		"import.main": "stack-agent: verification ผ่าน แต่ขั้น against แสดงไม่ได้ว่าการแก้ของคุณถูกทดสอบ: เทสต์ที่เปลี่ยน import สิ่งที่โค้ดก่อนแก้ไม่มี{listed} บนโค้ดนั้นเทสต์จึงล้มก่อนจะทดสอบอะไร ให้เพิ่ม check ใน {verify} ที่ล้มเมื่อไม่มีการแก้ของคุณ ถ้าโปรแกรมรันโค้ดใหม่อยู่แล้ว ให้รันแบบที่ผู้ใช้ทำ (คำสั่ง หรือ HTTP request ด้วยข้อมูลที่ไปถึงมัน) ถ้ายังไม่มีอะไรเรียกโค้ดใหม่ ให้เรียกตรงๆ ด้วย command check เช่น `\"args\": [\"node\", \"--input-type=module\", \"-e\", \"import { {name} } from './src/<module>.js'; console.log(JSON.stringify({name}(<input>)))\"]` หรือ `\"args\": [\"python\", \"-c\", \"from <module> import {name}; print({name}(<input>))\"]` โดยตั้ง `expectOutputIncludes` เป็นผลที่คุณคาดไว้: บนโค้ดก่อนแก้มันจะล้ม และนั่นคือหลักฐาน จากนั้นรัน `node .stack-agent/bin/verify.mjs` อีกครั้ง ถ้าเรียกโค้ดใหม่ไม่ได้เลยจริงๆ ให้บอกเหตุผลแล้วหยุด เรื่องนี้ถามครั้งเดียว\n",
		"ask.force-push": "force-push เขียนประวัติที่ใช้ร่วมกันทับ และคนอื่นย้อนกลับไม่ได้ ต้องให้คนอนุมัติก่อน",
		"ask.push-delete": "push นี้ลบ branch หรือ tag บน remote ต้องให้คนอนุมัติก่อน",
		"ask.reset-hard": "`git reset --hard` ทิ้งงานที่ยังไม่ commit ถาวร ต้องให้คนอนุมัติก่อน",
		"ask.clean": "`git clean -f` ลบไฟล์ที่ git ยังไม่รู้จักถาวร ต้องให้คนอนุมัติก่อน",
		"ask.discard-all": "คำสั่งนี้ทิ้งการแก้ไขในเครื่องของทุกไฟล์ถาวร ต้องให้คนอนุมัติก่อน",
		"ask.branch-delete": "`git branch -D` ลบ branch แม้ commit ในนั้นยังไม่ถูก merge ที่ไหนเลย งานอาจหาย ต้องให้คนอนุมัติก่อน",
		"ask.branch-force-move": "`git {sub}` แบบบังคับ จะย้าย branch ที่มีอยู่ไปชี้ commit อื่น commit เดิมจะเหลือแค่ใน reflog ต้องให้คนอนุมัติก่อน",
		"ask.stash-drop": "คำสั่งนี้ลบงานที่เก็บไว้ใน stash ถาวร ต้องให้คนอนุมัติก่อน",
		"ask.allow-increase": "`--allow-increase` ยกเพดาน baseline ของ guard แล้วยอมรับการฝ่าฝืนกฎใหม่ ต้องให้คนอนุมัติก่อน",
		"ask.git-hooks": "คำสั่งนี้แก้ git hook ในเครื่องของ repo (.git/hooks) ซึ่งเป็นด่านที่รัน guard ก่อน commit และการแก้ตรงนี้ไม่ปรากฏใน diff ต้องให้คนอนุมัติก่อน",
		"ask.workflows-delete": "คำสั่งนี้ลบโฟลเดอร์ที่เก็บ workflow CI ของ Stack Agent ซึ่งเป็นด่านที่ยังทำงานแม้ hook จะไม่ทำงาน ต้องให้คนอนุมัติก่อน",
		"ask.evidence": 'การกระทำนี้เขียน{what}ด้วยมือ ปกติมีแต่ verify.mjs ที่เขียน (รันมัน หรือใช้ verify.mjs --skip "<reason>") ถ้าเขียนเองจะเหมือนบอกว่าตรวจแล้วทั้งที่ยังไม่ได้ตรวจ ต้องให้คนอนุมัติก่อน',
		"ask.protected": "การกระทำนี้แก้{what} ซึ่งคุมว่า guard บังคับอะไร การผ่อนมันคือวิธีที่กฎถูกเลี่ยง จึงต้องให้คนอนุมัติก่อน ถ้าจะแก้การฝ่าฝืน ให้แก้ที่โค้ดแทน{setup}",
		"ask.setup-hint": " ถ้ากำลังกรอก template ที่ init เพิ่งเขียน (ยังมี EDIT ME และยังไม่ได้ commit) ให้ใช้เครื่องมือ Edit หรือ Write แทน สองตัวนั้นไม่ถามเรื่องนี้",
		"what.the guard rules": "กฎของ guard",
		"what.the guard baseline": "baseline ของ guard",
		"what.the vendored Stack Agent tools": "เครื่องมือ Stack Agent ที่ copy ไว้ในโปรเจค",
		"what.the Stack Agent CI workflow": "workflow CI ของ Stack Agent",
		"what.the verify evidence": "หลักฐานของ verify",
		"what.the verify skip record": "บันทึกการข้าม verify",
		"what.the Stop hook's session record": "บันทึก session ของ Stop hook",
		"what.the Stack Agent folder and its evidence": "โฟลเดอร์ Stack Agent และหลักฐานในนั้น",
		"what.the shared guard rules (a file guard.config.json extends)": "กฎ guard ที่ใช้ร่วมกัน (ไฟล์ที่ guard.config.json ต่อยอดมา)",
		"what.the repo's local git hooks (.git/hooks)": "git hook ในเครื่องของ repo (.git/hooks)",
		"deny.hookspath-override": "ถูกบล็อก: การเขียนทับ core.hooksPath ปิด git hook ของ repo และ guard ให้แก้ตามที่ hook รายงานแทน",
		"deny.alias-skips": "ถูกบล็อก: git alias นี้ commit หรือ push โดยไม่ผ่าน git hook ของ repo ซึ่งข้าม guard และการตรวจ ให้แก้ตามที่ hook รายงานแทน",
		"deny.hookspath-config": "ถูกบล็อก: การตั้ง core.hooksPath ปิด git hook ของ repo และ guard ให้แก้ตามที่ hook รายงานแทน",
		"deny.env-hooks": "ถูกบล็อก: `{env}` ปิด git hook ของ repo สำหรับ `git {sub}` นี้ ให้แก้ตามที่ hook รายงานแทน",
		"deny.no-verify": "ถูกบล็อก: `git {sub} --no-verify` ข้าม guard และการตรวจของ repo ให้แก้ตามที่ hook รายงานแทน",
		"deny.commit-n": "ถูกบล็อก: `git commit -n` คือ --no-verify ข้าม guard และการตรวจของ repo ให้แก้ตามที่ hook รายงานแทน",
		"deny.hookspath-gitconfig-env": "ถูกบล็อก: การตั้ง core.hooksPath ผ่าน GIT_CONFIG_* ปิด git hook ของ repo และ guard ให้แก้ตามที่ hook รายงานแทน",
		"deny.export-env": "ถูกบล็อก: `{env}` ปิด git hook ของ repo สำหรับทุกคำสั่งหลังจากนี้ ให้แก้ตามที่ hook รายงานแทน",
	},
};

// Fills {name} placeholders in one pass, so text that came from outside (a file name, the agent's own reason) is
// never read as a placeholder. A missing message or value throws: it is a mistake in the code, and a test finds it.
export function t(lang, key, params = {}) {
	const catalog = MESSAGES[lang];
	if (!catalog) throw new Error(`messages: no catalog for language ${JSON.stringify(lang)}`);
	if (typeof catalog[key] !== "string") throw new Error(`messages: no message ${JSON.stringify(key)} in ${lang}`);
	return catalog[key].replace(/\{(\w+)\}/g, (_, name) => {
		if (!(name in params)) throw new Error(`messages: ${key} needs a value for {${name}}`);
		return String(params[name]);
	});
}

// Messages whose Thai text the agent reads (a denial, a reminder) are used in Thai only once the Thai version has been
// measured to be followed as well as the English one (docs/design-notes.md). Until then the agent gets English. A
// question for a human (PreToolUse "ask") is read by a person, so it follows the language setting.
export const AGENT_THAI = new Set(["remind", "coverage", "import"]);

// the language to write a message in when the agent is the reader
export const agentLang = (lang, key) => (lang === "th" && AGENT_THAI.has(key) ? "th" : "en");

// the Thai name of what a message is about; a name nobody listed (a folder from the project's own config) stays as it is
export function whatName(lang, what) {
	const key = `what.${what}`;
	return typeof MESSAGES[lang]?.[key] === "string" ? MESSAGES[lang][key] : what;
}

// A hook's verdict is {decision, key, params} plus an English `reason` for tests and for callers that read the text.
// This is the text for the reader: a human for "ask", the agent for anything else.
export function renderVerdict(verdict, lang) {
	if (!verdict.key) return verdict.reason;
	const use = verdict.decision === "ask" || AGENT_THAI.has(verdict.key) ? lang : "en";
	const params = { ...verdict.params };
	if ("what" in params) params.what = whatName(use, params.what);
	if ("setup" in params) params.setup = params.setup ? t(use, "ask.setup-hint") : "";
	return t(use, verdict.key, params);
}

// the verdict a hook returns: the English reason stays for tests, the key and params let the hook render another language
export const makeVerdict = (decision, key, params = {}) => ({ decision, key, params, reason: renderVerdict({ decision, key, params }, "en") });

// What a SessionStart hook adds to the agent's context when the language is Thai. It states what is set and what the
// reader expects, as facts, since Claude Code treats context worded as commands with suspicion.
const THAI_NOTE =
	"Language setting: this project's Stack Agent language is Thai (STACK_AGENT_LANG=th, or \"language\": \"th\" in .stack-agent/verify.json). " +
	"The person reading this session prefers Thai written plainly: short sentences, everyday words, the answer first, and as little jargon as possible. " +
	"Code, commands, file names, and error output are quoted as they are. The reminders Stack Agent sends to the agent stay in English.";

export const agentLanguageNote = (lang) => (lang === "th" ? THAI_NOTE : null);
