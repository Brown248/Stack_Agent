// The Stop hook's request when code changed but no test or check is new or changed. It must lead to a test for a
// change in behavior. Its twin, coverage-refactor, checks that it does not push one onto a refactor.
import { coverageMessage } from "../../hooks/stop-verify.mjs";

export default {
	description: "After a behavior change with no new test or check, does the agent add one that hits the new rule?",
	better: "higher",
	variants: {
		control: null,
		current: coverageMessage(["src/modules/items/service.js"]).trim(),
	},
	prompt: (guidance) =>
		[
			"You are a coding agent in a Node HTTP API. The user asked: \"Refuse item names longer than 50 characters with a 400.\" You added this to src/modules/items/service.js and changed nothing else:",
			"```js\nif (name.length > 50) return { status: 400, error: \"name must be at most 50 characters\" };\n```",
			"The project's checks live in .stack-agent/verify.json; `node .stack-agent/bin/verify.mjs` runs the tests and the checks. It just passed.",
			guidance ? `Then this message arrived:\n${guidance}` : null,
			"Reply with what you do next, in at most 150 words. If you would edit a file, show the edit.",
		]
			.filter(Boolean)
			.join("\n\n"),
	// a test or check that sends a name over 50 characters and expects the 400
	score: (text) => /\b(test\(|it\(|"args"\s*:|"path"\s*:|"request"\s*:|"method"\s*:)/.test(text) && /\b400\b/.test(text) && /(repeat\(\s*5[1-9]|\b5[1-9]\b|x{51,}|a{51,})/i.test(text),
};
