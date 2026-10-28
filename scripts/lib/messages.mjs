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

// What a SessionStart hook adds to the agent's context when the language is Thai. It states what is set and what the
// reader expects, as facts, since Claude Code treats context worded as commands with suspicion.
const THAI_NOTE =
	"Language setting: this project's Stack Agent language is Thai (STACK_AGENT_LANG=th, or \"language\": \"th\" in .stack-agent/verify.json). " +
	"The person reading this session prefers Thai written plainly: short sentences, everyday words, the answer first, and as little jargon as possible. " +
	"Code, commands, file names, and error output are quoted as they are. The reminders Stack Agent sends to the agent stay in English.";

export const agentLanguageNote = (lang) => (lang === "th" ? THAI_NOTE : null);
