// The two scripts we changed in the imported skills (see THIRD_PARTY_NOTICES.md) are run for real, so the extra care
// stays in the code and not only in the instructions: the step-script template refuses an .env that git would not ignore
// and aims every gh call at one named repository.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { bash, repoRoot, shPath as sh, tempDir, write } from "./helpers.mjs";

const skip = bash ? false : "bash is not available";

const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), "utf8");
// a wizard is this library plus its own stages; the tests write the stages
const library = read("skills/step-script/template.sh").split("run_wizard() {")[0];

function fakeGh(dir) {
	const bin = path.join(dir, "bin");
	write(
		bin,
		"gh",
		`#!/usr/bin/env bash
echo "$*" >> "${sh(dir)}/gh.log"
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") echo "acme/widgets" ;;
esac
cat >/dev/null 2>&1 || true
exit 0
`,
	);
	fs.chmodSync(path.join(bin, "gh"), 0o755);
	return bin;
}

function runWizard(dir, stages, env = {}) {
	write(dir, "wizard.sh", `${library}\n${stages}\n`);
	return spawnSync(bash, [sh(path.join(dir, "wizard.sh"))], {
		cwd: dir,
		encoding: "utf8",
		input: "",
		env: { ...process.env, PATH: `${path.join(dir, "bin")}${path.delimiter}${process.env.PATH}`, ...env },
	});
}

function repoWithEnvIgnored(ignored) {
	const dir = tempDir("stack-agent-wizard-");
	assert.equal(spawnSync("git", ["init", "-q"], { cwd: dir }).status, 0);
	if (ignored) write(dir, ".gitignore", ".env\n");
	fakeGh(dir);
	return dir;
}

test("step-script template writes the secret to .env only when git ignores the file", { skip }, () => {
	const dir = repoWithEnvIgnored(true);
	const r = runWizard(dir, `write_env API_KEY 'abc'`);
	assert.equal(r.status, 0, r.stderr);
	assert.match(fs.readFileSync(path.join(dir, ".env"), "utf8"), /^API_KEY='abc'$/m);
});

test("step-script template refuses to write when .env is not git-ignored, and writes nothing", { skip }, () => {
	const dir = repoWithEnvIgnored(false);
	const r = runWizard(dir, `write_env API_KEY 'abc'`);
	assert.notEqual(r.status, 0);
	assert.match(r.stderr, /not git-ignored/);
	assert.equal(fs.existsSync(path.join(dir, ".env")), false, "no file was created");
});

test("step-script template refuses a .env that git already tracks, even if .gitignore now lists it", { skip }, () => {
	const dir = repoWithEnvIgnored(false);
	write(dir, ".env", "OLD=1\n");
	spawnSync("git", ["add", ".env"], { cwd: dir });
	write(dir, ".gitignore", ".env\n");
	const r = runWizard(dir, `write_env API_KEY 'abc'`);
	assert.notEqual(r.status, 0);
	assert.doesNotMatch(fs.readFileSync(path.join(dir, ".env"), "utf8"), /API_KEY/);
});

test("step-script template writes outside a git work tree (nothing there to commit it to)", { skip }, () => {
	const dir = tempDir("stack-agent-wizard-plain-");
	fakeGh(dir);
	const r = runWizard(dir, `write_env API_KEY 'abc'`);
	assert.equal(r.status, 0, r.stderr);
});

test("step-script template aims gh secret set and gh variable set at one repository and says which", { skip }, () => {
	const dir = repoWithEnvIgnored(true);
	const r = runWizard(dir, `set_secret TOKEN 'shh'\nset_var MODE 'fast'`);
	assert.equal(r.status, 0, r.stderr);
	const log = fs.readFileSync(path.join(dir, "gh.log"), "utf8");
	assert.match(log, /secret set TOKEN -R acme\/widgets/);
	assert.match(log, /variable set MODE --body fast -R acme\/widgets/);
	assert.match(r.stdout, /GitHub secret TOKEN in acme\/widgets/);
	assert.doesNotMatch(r.stdout + r.stderr, /shh/, "the secret is never printed");
});

test("WIZARD_REPO names the repository instead of the folder's own", { skip }, () => {
	const dir = repoWithEnvIgnored(true);
	const r = runWizard(dir, `set_secret TOKEN 'shh'`, { WIZARD_REPO: "me/other" });
	assert.equal(r.status, 0, r.stderr);
	const log = fs.readFileSync(path.join(dir, "gh.log"), "utf8");
	assert.match(log, /secret set TOKEN -R me\/other/);
	assert.doesNotMatch(log, /repo view/, "no lookup when the repository is named");
});

test("step-script template skips and says so when it cannot tell which repository to use", { skip }, () => {
	const dir = repoWithEnvIgnored(true);
	write(dir, "bin/gh", `#!/usr/bin/env bash\necho "$*" >> "${sh(dir)}/gh.log"\n[ "$1 $2" = "auth status" ] && exit 0\nexit 1\n`);
	fs.chmodSync(path.join(dir, "bin", "gh"), 0o755);
	const r = runWizard(dir, `set_secret TOKEN 'shh'\nfinish`);
	assert.equal(r.status, 0, r.stderr);
	assert.doesNotMatch(fs.readFileSync(path.join(dir, "gh.log"), "utf8"), /secret set/, "no secret was sent");
	assert.match(r.stdout, /still to do by hand/);
});

