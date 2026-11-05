// A project skill written the way upstream-style advice warns against: the description is the procedure, the body is long
// and says the same things several times. The rollback rule is buried in the middle. Committed, so the agent's changes
// are the only change.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const filler = [
	"Always make sure the tests pass before moving on to the next part of the deploy.",
	"Remember to never skip the tests. The tests must pass.",
	"Do not forget that the image has to be built from the current commit.",
	"Take care that the manifest is updated only after the push has finished.",
	"It is important to watch the rollout and not to walk away from it.",
];
const body = [];
body.push("# Deploy", "", "This skill is for deploying the app. Please read all of it before you start.", "");
for (let round = 1; round <= 6; round++) {
	body.push(`## Notes ${round}`, "", ...filler.map((l) => `- ${l}`), "");
}
body.push("## Steps", "", "1. Run the tests: `npm test`.", "2. Build the image: `docker build -t app:$(git rev-parse --short HEAD) .`", "3. Push the image: `docker push registry.example.com/app:$(git rev-parse --short HEAD)`", "4. Update the manifest: set the image tag in `deploy/manifest.yaml`.", "5. Watch the rollout: `kubectl rollout status deploy/app`.", "");
for (let round = 7; round <= 12; round++) {
	body.push(`## Notes ${round}`, "", ...filler.map((l) => `- ${l}`), "");
}
body.push("## If the rollout fails", "", "Roll back with `kubectl rollout undo deploy/app` and tell the team before trying again.", "");
const text = `---\nname: deploy\ndescription: Deploys the app: first runs the tests, then builds the docker image, then pushes it, then updates the manifest and watches the rollout.\n---\n\n${body.join("\n")}`;
fs.mkdirSync("team-skills/deploy", { recursive: true });
fs.writeFileSync("team-skills/deploy/SKILL.md", text);
const git = (...args) => execFileSync("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: process.cwd(), stdio: "ignore" });
git("add", "-A");
git("commit", "-qm", "add the deploy skill");
