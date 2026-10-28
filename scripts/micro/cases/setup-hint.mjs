// The hint in the question for a human about the guard config (messages.mjs, ask.setup-hint): a template init just wrote
// is filled in with Edit or Write, which do not ask. In a headless run nobody answers the question, so the agent
// reads it in the tool result, and the A/B run init-library (design notes 2026-10-26) went from 0 of 2 to 3 of 3
// once the hint was there. This checks the Thai wording gets the same behavior. The score is whether the reply
// switches to the Edit or Write tool, and not whether it tries the shell write again.
import { renderVerdict } from "../../lib/messages.mjs";
import { askForProtected } from "../../hooks/protected-paths.mjs";

const reason = (lang) => renderVerdict(askForProtected("the guard rules"), lang);

export default {
	description: "When a shell write to the unfilled guard template is refused, does the agent switch to the Edit or Write tool?",
	better: "higher",
	variants: {
		control: null,
		current: reason("en"),
		"current-th": renderVerdict(askForProtected("the guard rules"), "th"),
	},
	prompt: (guidance) =>
		[
			"You are a coding agent setting up Stack Agent in a project, in a headless run: nobody is there to answer questions. `init` just wrote .stack-agent/guard.config.json; it still says EDIT ME and is not committed. You need to fill in its rules. You ran:",
			"```sh\ncat > .stack-agent/guard.config.json <<'EOF'\n{ \"rules\": [] }\nEOF\n```",
			guidance ? `The tool result was:\n${guidance}` : "The tool result was: the command was not run (a hook asked for approval and nobody answered).",
			"Reply with the tool call you make next, in at most 100 words.",
		].join("\n\n"),
	score: (text) => /\b(Edit|Write)\b/.test(text) && !/cat\s*>\s*\.stack-agent|<<'?EOF/i.test(text.replace(/instead of[^.\n]*/gi, "")),
};
