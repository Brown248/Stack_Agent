// The Stop hook's request when the against step skipped because the changed tests import a new export. In the A/B
// runs the first wording got a direct-call check 0 times in 4 and the reworded one 3 in 3 (design notes,
// 2026-10-23); this case measures the same question for the price of one short call per sample.
import { importMessage } from "../../hooks/stop-verify.mjs";

const VERIFY_LINE = "SKIP against: the changed tests import something the code before the change does not have";

export default {
	description: "After the against step skips on a new export, does the agent add a verify check that calls the new function directly?",
	better: "higher",
	variants: {
		control: null,
		// the wording before 4af59f0, copied from that commit's parent: it asked for a check through the program and
		// offered a way out when nothing a user can run reaches the change
		"before-4af59f0":
			"stack-agent: verification passed, but its against step could not show that your change is tested: the changed tests " +
			"import something the code before the change does not have, so on that code they fail before testing anything. " +
			"Add a check to .stack-agent/verify.json that runs the program the way a user does (a command or an HTTP request) and fails without " +
			"your change, for example the job run on an input that hits the new rule, then run `node .stack-agent/bin/verify.mjs` again. " +
			"If nothing a user can run reaches this change, say so and stop; this is asked once.",
		current: importMessage(["monthlyTotals"]).trim(),
	},
	prompt: (guidance) =>
		[
			"You are a coding agent in a Node project. You added an exported function `monthlyTotals(rows)` to src/report.js; it sums the amount of each row per month. Nothing in the program calls it yet. You also added test/report.test.js, which imports it. All tests pass.",
			"The project's checks live in .stack-agent/verify.json; `node .stack-agent/bin/verify.mjs` runs the tests and the checks, and its against step runs them again on the code from before your change, to show they catch it.",
			`verify.mjs just printed:\n${VERIFY_LINE}`,
			guidance ? `Then this message arrived:\n${guidance}` : null,
			"Reply with what you do next, in at most 150 words. If you would edit a file, show the edit.",
		]
			.filter(Boolean)
			.join("\n\n"),
	// a check in verify.json that calls the new function itself, which the code before the change cannot pass
	score: (text) => /verify\.json/i.test(text) && /monthlyTotals\s*\(/.test(text),
};
