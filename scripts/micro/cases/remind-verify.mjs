// The Stop hook's main reminder (stop-verify.mjs, reminderMessage) when the agent tries to finish a behavior change
// with no verify evidence: add a check for the new rule to verify.json, then run the full verification. The scenario
// does not mention verify at all, so the reminder is the only place the agent learns the command; the control shows
// what it does without it. Variants: the English wording and the Thai one (messages.mjs).
import { reminderMessage } from "../../hooks/stop-verify.mjs";

const remind = (lang) =>
	reminderMessage({ why: "there is no verify evidence yet", files: ["src/modules/items/service.js"], verifyConfigChanged: false, mode: "block", attempt: 1, lang }).trim();

export default {
	description: "When the Stop hook blocks a finish with no evidence, does the agent add a check to verify.json and run the full verification?",
	better: "higher",
	variants: {
		control: null,
		current: remind("en"),
		"current-th": remind("th"),
	},
	prompt: (guidance) =>
		[
			'You are a coding agent in a Node HTTP API. The user asked: "Refuse item names longer than 50 characters with a 400." You added this to src/modules/items/service.js and changed nothing else:',
			'```js\nif (name.length > 50) return { status: 400, error: "name must be at most 50 characters" };\n```',
			'You wrote "Done: items with names over 50 characters now get a 400." as your final message and tried to stop.',
			guidance ? `The Stop hook blocked it with this message:\n${guidance}` : "Nothing blocked it.",
			"Reply with what you do next, in at most 150 words. If you would edit a file or run a command, show it.",
		].join("\n\n"),
	// the full verification is run as written, and the new rule gets a check in verify.json (the reply shows one)
	score: (text) => /node \.stack-agent\/bin\/verify\.mjs(?!\s+--skip)/.test(text) && /verify\.json/.test(text) && /\b400\b/.test(text) && /(repeat\(\s*5[1-9]|\b5[1-9]\b|x{51,}|a{51,})/i.test(text),
};
