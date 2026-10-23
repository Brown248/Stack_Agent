// For eval cases that start from a history: replaces text in files of the scaffolded project and commits the
// result, so the agent finds a bug or a repeated mistake that is already in git. Each case's setup.mjs calls it
// after scaffold.mjs has made the starting commit.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function plant(dir, edits, message) {
	for (const [rel, from, to] of edits) {
		const file = path.join(dir, rel);
		const text = fs.readFileSync(file, "utf8");
		if (!text.includes(from)) throw new Error(`plant: ${rel} does not contain ${JSON.stringify(from)}`);
		fs.writeFileSync(file, text.replace(from, to));
	}
	const git = (...args) => execFileSync("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, stdio: "ignore" });
	git("add", "-A");
	git("commit", "-qm", message);
}
