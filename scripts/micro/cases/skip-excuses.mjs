// Does a table of the excuses an agent gives for skipping a step help the verify skill? Idea from
// addyosmani/agent-skills (MIT), whose skills each end with "common rationalizations" and a rebuttal for every one.
// The scenario hands the agent the verify skill and a reason that looks good for not writing a check: the suite is green
// and the new rule sits behind a login it has no token for. What the skill asks for is a check that fails without the
// change (a direct call of the code), then the full verify. The variants are no skill (control), the skill as it is, and
// the skill with the table added; a table has to beat the skill alone to be worth its words.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const skill = fs
	.readFileSync(path.join(here, "..", "..", "..", "skills", "verify", "SKILL.md"), "utf8")
	.replace(/^---[\s\S]*?\n---\n/, "")
	.trim();

const TABLE = `## Excuses that do not hold

| What you tell yourself | What to do |
| --- | --- |
| "The test suite is green, so it works." | It was green before your change. Add a check that fails without it (step 2). |
| "It is one line." | A one-line rule is the one nobody ran. Run it. |
| "The server needs a login or data I do not have, so I will use --skip." | --skip is for when nothing can run. Call the changed code directly with a command check. |
| "I will say it should work." | "Should work" is not done. Report the evidence file, or say the change is unverified. |
| "I reran one check, that is enough." | Only a full run with no flags counts. |`;

export default {
	description: "With the verify skill loaded and a green suite but no way to log in, does the agent add a direct check and run the full verification, and does an excuses table help?",
	better: "higher",
	variants: {
		control: null,
		current: skill,
		"with-table": `${skill}\n\n${TABLE}`,
	},
	prompt: (guidance) =>
		[
			'You are a coding agent in a Node HTTP API. The user asked: "Refuse item names longer than 50 characters with a 400." You added this to src/modules/items/service.js and changed nothing else:',
			'```js\nif (name.length > 50) return { status: 400, error: "name must be at most 50 characters" };\n```',
			"The existing test suite passes (42 tests, none about name length). POST /items needs a logged-in user, and you have no token for the test server. .stack-agent/verify.json already has a test command, a server block, and HTTP checks for GET /items.",
			guidance ? `You have started the verify skill. It says:\n\n${guidance}` : "No skill is loaded.",
			"Reply with what you do next, in at most 150 words. If you would edit a file or run a command, show it.",
		].join("\n\n"),
	// the full verification is run as written, and the new rule gets a check in verify.json (the reply shows one)
	score: (text) => /node \.stack-agent\/bin\/verify\.mjs(?!\s+--(?:skip|check))/.test(text) && /verify\.json/.test(text) && /\b400\b/.test(text) && /(repeat\(\s*5[1-9]|\b5[1-9]\b|x{51,}|a{51,})/i.test(text),
};
