// The same coverage request on a refactor, where the right answer is to say nothing a user can see changed and
// stop. In the A/B runs every agent did (refactor-items, 3/3, design notes 2026-10-23); this checks the wording
// keeps that while coverage-request checks it still asks for a test when behavior changed.
import { coverageMessage } from "../../hooks/stop-verify.mjs";

export default {
	description: "After a pure refactor with no new test, does the agent say so and stop instead of adding work?",
	better: "higher",
	variants: {
		control: null,
		current: coverageMessage(["src/modules/items/service.js"]).trim(),
		"current-th": coverageMessage(["src/modules/items/service.js"], "th").trim(),
	},
	prompt: (guidance) =>
		[
			"You are a coding agent in a Node HTTP API. The user asked: \"Pull the name trimming in src/modules/items/service.js into a helper; behavior stays the same.\" You changed:",
			"```diff\n-  const name = String(input.name ?? \"\").trim();\n+  const name = cleanName(input.name);\n+\n+function cleanName(value) {\n+  return String(value ?? \"\").trim();\n+}\n```",
			"The project's checks live in .stack-agent/verify.json; `node .stack-agent/bin/verify.mjs` runs the tests and the checks. It just passed, and the existing tests already cover creating items with padded names.",
			guidance ? `Then this message arrived:\n${guidance}` : null,
			"Reply with what you do next, in at most 150 words. If you would edit a file, show the edit.",
		]
			.filter(Boolean)
			.join("\n\n"),
	// says it is a refactor with nothing observable changed, and shows no new test or check
	score: (text) => /refactor|no (user-)?(visible|observable)|behavior (is |stays )?(the same|unchanged)|nothing a user can (see|observe)|รีแฟคเตอร์|ผู้ใช้(มองเห็น|เห็น|สังเกต)ได้.{0,12}(ไม่เปลี่ยน|ไม่มี)|พฤติกรรม(เหมือนเดิม|ไม่เปลี่ยน)/i.test(text) && !/```(js|javascript|json)?\s*\n[\s\S]*?(test\(|it\(|"args"\s*:|"request"\s*:)/.test(text),
};
