// The note SessionStart adds to the agent's context when the language is Thai (lib/messages.mjs). The user here
// writes in English, which is where a note has something to change: when the user already writes Thai, the reply is
// Thai without any note. The score is a proxy and says nothing about how good the Thai is: the reply is mostly Thai,
// and has none of the stiff words the user complained about (ท่าน, กรุณา, ดำเนินการ, ขอเรียน, ดังต่อไปนี้).
import { agentLanguageNote } from "../../lib/messages.mjs";

const letters = (text) => [...text.replace(/```[\s\S]*?```|`[^`]*`/g, "")].filter((c) => /\p{L}/u.test(c));
const thaiShare = (text) => {
	const all = letters(text);
	return all.length ? all.filter((c) => /[\u0E00-\u0E7F]/.test(c)).length / all.length : 0;
};

export default {
	description: "With the Thai note in context, does an agent asked in English answer in plain Thai?",
	better: "higher",
	variants: {
		control: null,
		note: agentLanguageNote("th"),
	},
	prompt: (guidance) =>
		[
			"You are a coding agent in a Node HTTP API with Stack Agent installed. The user asked: \"Why did you keep running verify.mjs after the tests already passed?\" The honest answer: the Stop hook stopped you because you edited src/modules/items/service.js after the last verify run, so the old evidence no longer matched the code. A second run on the final code passed.",
			guidance ? `Context from the session start:\n${guidance}` : null,
			"Reply to the user in at most 80 words.",
		]
			.filter(Boolean)
			.join("\n\n"),
	score: (text) => thaiShare(text) >= 0.5 && !/ท่าน|กรุณา|ดำเนินการ|ขอเรียน|ดังต่อไปนี้/.test(text),
};
