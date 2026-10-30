// An older line in a project skill that the new correction contradicts. The correction routes to rules.md or the
// guard, so only a search of the skills for a conflicting line finds it: the skill's description is all the agent
// sees without opening the file.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const dir = process.cwd();
const file = path.join(dir, ".claude", "skills", "quick-lookup", "SKILL.md");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(
	file,
	[
		"---",
		"name: quick-lookup",
		"description: Use when adding a small read-only endpoint that returns one record or a short list.",
		"---",
		"",
		"# Quick lookup endpoints",
		"",
		"1. Register the route in `src/routes.js`.",
		"2. A query of one SELECT may stay in the controller; move it to `repository.js` only when it grows.",
		"3. Return the rows with `res.json(200, rows)`.",
		"",
	].join("\n"),
);
const git = (...args) => execFileSync("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "ignore" });
git("add", "-A");
git("commit", "-qm", "skills: quick-lookup keeps one-line queries in the controller");
