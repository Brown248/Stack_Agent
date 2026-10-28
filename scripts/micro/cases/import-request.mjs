// The Stop hook's request when the against step skipped because the changed tests import a new export. In the A/B
// runs the first wording got a direct-call check 0 times in 4 and the reworded one 3 in 3 (design notes,
// 2026-10-23); this case measures the same question for the price of one short call per sample.
import { importMessage } from "../../hooks/stop-verify.mjs";

const VERIFY_LINE = "SKIP against: the changed tests import something the code before the change does not have";

const FUNCTIONS = [
	{ fn: "monthlyTotals", signature: "monthlyTotals(rows)", file: "src/report.js", test: "test/report.test.js", does: "sums the amount of each row per month", argument: /[[{]/ },
	{ fn: "slugify", signature: "slugify(title)", file: "src/text.js", test: "test/text.test.js", does: "turns a title into a url slug", argument: /[[{"']/ },
	{ fn: "parseDuration", signature: "parseDuration(text)", file: "src/time.js", test: "test/time.test.js", does: "turns text like 1h30m into seconds", argument: /[[{"']/ },
];

const scenarios = FUNCTIONS.map((f) => ({
	name: f.fn,
	// the wording under test names monthlyTotals; the other scenarios get their own function in its place
	prompt: (guidance) =>
		[
			`You are a coding agent in a Node project. You added an exported function \`${f.signature}\` to ${f.file}; it ${f.does}. Nothing in the program calls it yet. You also added ${f.test}, which imports it. All tests pass.`,
			"The project's checks live in .stack-agent/verify.json; `node .stack-agent/bin/verify.mjs` runs the tests and the checks, and its against step runs them again on the code from before your change, to show they catch it.",
			`verify.mjs just printed:\n${VERIFY_LINE}`,
			guidance ? `Then this message arrived:\n${guidance.replaceAll("monthlyTotals", f.fn)}` : null,
			"Reply with what you do next, in at most 150 words. If you would edit a file, show the edit.",
		]
			.filter(Boolean)
			.join("\n\n"),
	// a check in verify.json that calls the new function on an input, which the code before the change cannot pass.
	// Naming the function is not enough: the first live run (2026-10-24) scored replies that refused ("I'm not editing
	// `.stack-agent/verify.json`… `monthlyTotals(rows)` is exported…") as passes; a call needs a literal argument.
	score: (text) => /verify\.json/i.test(text) && /"args"\s*:|"command"\s*:/.test(text) && new RegExp(`${f.fn}\\s*\\(\\s*${f.argument.source}`).test(text),
}));

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
		"current-th": importMessage(["monthlyTotals"], "th").trim(),
	},
	prompt: (guidance) => scenarios[0].prompt(guidance),
	score: (text) => scenarios[0].score(text),
	// three functions for the tuning loop (tune.mjs): it learns from the first two and holds the last back
	scenarios,
	// a rewrite of the request must keep the file and the command it points the agent to
	keep: ["verify.json", "node .stack-agent/bin/verify.mjs"],
};
