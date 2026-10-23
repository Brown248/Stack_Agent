import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { classify } from "../scripts/hooks/pre-bash.mjs";
import { copySample, git, repoRoot, runNode, write } from "./helpers.mjs";

const hook = (name) => path.join(repoRoot, "scripts", "hooks", name);
const hookInput = (obj) => JSON.stringify(obj);
// "remind" is the pre-blocking Stop hook behavior; tests/stop-block.test.mjs covers the default "block" mode
const useRemind = (dir) => {
	const file = path.join(dir, ".stack-agent/verify.json");
	fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), stopHook: "remind" }, null, 2));
};

test("pre-bash denies guard bypasses, including global git options and hook-disabling env", () => {
	for (const cmd of [
		'git commit -m "x" --no-verify',
		"git commit -nm wip",
		"git -C repo push --no-verify",
		"git --no-pager commit --no-verify",
		"git -P commit -n",
		"git --git-dir=.git commit --no-verify",
		"git -c core.hooksPath=/dev/null commit -m x",
		"HUSKY=0 git commit -m x",
		'bash -c "git commit --no-verify -m x"',
	]) {
		assert.equal(classify(cmd)?.decision, "deny", cmd);
	}
});

test("pre-bash asks before destructive, baseline-raising, or guard-loosening commands", () => {
	for (const cmd of [
		"git push --force origin main",
		"git push -f",
		"git push -fu origin main",
		"git push origin +main",
		"git push --force-with-lease",
		"git push --mirror",
		"git push origin :main",
		"git push origin --delete main",
		'bash -c "git push --force origin main"',
		'powershell -Command "git push --force"',
		"npm test && git push -f",
		"git reset --hard HEAD~1",
		"git clean -fd",
		"git clean --force -d",
		"git checkout -- .",
		"git checkout .",
		"git restore .",
		"git stash clear",
		"git branch -D feat/x",
		"git branch -df feat/x",
		"git branch --delete --force feat/x",
		"git branch --del --forc feat/x",
		"git -C repo branch -D old",
		"node .stack-agent/bin/guard.mjs --update-baseline --allow-increase",
		"npm run guard -- --update-baseline --allow-increase",
		"sed -i s/1/5/ .stack-agent/guard-baseline.json",
		"echo {} > .stack-agent/guard-baseline.json",
		"Set-Content .stack-agent/guard.config.json x",
		`node -e "require('fs').writeFileSync('.stack-agent/guard.config.json','{}')"`,
		`node -e "require('fs').rmSync('.stack-agent',{recursive:true})"`,
		`node -e "require('fs').rmSync('.stack-agent/evidence',{recursive:true,force:true})"`,
		`node -e "require('fs').writeFileSync(require('path').join('.stack-agent','evidence','latest.json'),'{}')"`,
		`node -e "require('fs').writeFileSync('.stack-agent/guard-baseline.json','{}')"`,
		`node -e "require('fs').copyFileSync('x.mjs','.stack-agent/bin/guard.mjs')"`,
		`python -c "open('.stack-agent/verify-skip.json','w').write('{}')"`,
		// Windows separators: tokenizing drops "\e" inside double quotes, Python keeps it
		`python -c "import shutil; shutil.rmtree('.stack-agent\\evidence')"`,
		`python -c "open('.stack-agent\\guard-baseline.json','w')"`,
		`node -e 'require("fs").writeFileSync(".stack-agent\\\\guard.config.json","{}")'`,
		// the vendored tools folder named without a trailing separator, and paths written to dodge the pattern
		`node -e "require('fs').rmSync('.stack-agent/bin',{recursive:true})"`,
		`node -e "require('fs').writeFileSync('.stack-agent//guard.config.json','{}')"`,
		`node -e "require('fs').writeFileSync('.stack-agent/evidence/../guard-baseline.json','{}')"`,
		`node -e "require('fs').writeFileSync('.stack-agent/./guard.config.json','{}')"`,
		// interpreter flags beyond -e / -c, and paths written with path.join
		`node --eval="require('fs').writeFileSync('.stack-agent/guard.config.json','{}')"`,
		`node -pe "require('fs').writeFileSync('.stack-agent/guard-baseline.json','{}')"`,
		`py -3 -c "open('.stack-agent/verify-skip.json','w').write('{}')"`,
		`python -Ic "open('.stack-agent/evidence/latest.json','w').write('{}')"`,
		`python3.12 -c "open('.stack-agent/evidence/latest.json','w').write('{}')"`,
		`deno eval "Deno.writeTextFileSync('.stack-agent/guard.config.json','{}')"`,
		// only the joined path names the workflow file: '.github' on its own is not protected
		`node -e "require('fs').writeFileSync(require('path').join(process.cwd(),'.github','workflows','stack-agent.yml'),'')"`,
		`python -X utf8 -W ignore -c "open('.stack-agent/evidence/latest.json','w')"`,
		`/usr/bin/python3 -c "open('.stack-agent/guard.config.json','w')"`,
		`pythonw -c "open('.stack-agent/guard.config.json','w')"`,
		`python -c "import shutil; shutil.rmtree('.github')"`,
		"rm -rf .github",
		"Remove-Item -Recurse .github",
		`node --eval "fs.rmSync(require('os').tmpdir()+'/stack-agent-sessions',{recursive:true})"`,
		`python -c "import os, shutil; shutil.rmtree(os.path.join('.stack-agent', 'evidence'))"`,
		`node -e "require('fs').rmSync('.github/workflows',{recursive:true})"`,
		"rm -rf .github/workflows",
		// commands that point an existing branch at other commits
		"git branch -f main HEAD~3",
		"git branch --force x HEAD~3",
		"git branch -C a main",
		"git checkout -B main HEAD~5",
		"git switch -C main",
		"git switch --force-create main",
		"cp other.mjs .stack-agent/bin/guard.mjs",
	]) {
		assert.equal(classify(cmd)?.decision, "ask", cmd);
	}
});

test("pre-bash lets ordinary commands through", () => {
	for (const cmd of [
		'git commit -m "fix -n flag docs"',
		'git commit -m "note; git push -f is bad"',
		"git commit -am wip",
		"git commit --amend",
		"git push origin feat/x",
		"git push -u origin feat/x",
		"git status; git log",
		"git restore --staged .",
		"git checkout main",
		// a script that edits a file in .stack-agent that is not protected (seen in a live debug run, 2026-10-21)
		`node -e "const f='.stack-agent/verify.json',j=JSON.parse(require('fs').readFileSync(f,'utf8'));require('fs').writeFileSync(f,JSON.stringify(j,null,2))"`,
		`node -e "require('fs').appendFileSync('.stack-agent/rules.md','- one more rule')"`,
		`python -c "open('.stack-agent/api-map.md','a').write('| GET | /x |')"`,
		`node -e "require('fs').writeFileSync('.stack-agent/binary-notes.txt','x')"`,
		`node -e "require('fs').writeFileSync('.stack-agent-old/x','x')"`,
		"node -c app.js",
		"git switch -c feat/new",
		"git checkout -b feat/new",
		"git branch -m old-name new-name",
		"ls .github/workflows",
		// adding, copying, or listing workflows is ordinary work; only deleting the folder asks
		"cp ci.yml .github/workflows/",
		"find .github -name '*.yml'",
		"cp -r templates/.github .",
		`python -c "import os; print(os.listdir('.github'))"`,
		`node -p "require('./package.json').github"`,
		`node -e "fs.writeFileSync(path.join('.github','workflows','ci.yml'),'x')"`,
		"rm -rf .github/workflows/ci.yml",
		// a script's own flags are not the interpreter's
		"node build.js -c .github",
		// the usual first step of a new repository
		"git branch -M main",
		"git branch --sort -refname",
		"cat .github/workflows/ci.yml",
		"git branch -d merged-branch",
		"git branch --delete merged-branch",
		"git branch -dr origin/old",
		"git branch feat/new",
		"git branch --list",
		"node .stack-agent/bin/guard.mjs",
		"node .stack-agent/bin/guard.mjs --update-baseline",
		"node .stack-agent/bin/verify.mjs 2>&1",
		"cat .stack-agent/guard-baseline.json",
		"git diff .stack-agent/guard.config.json",
		"git reset HEAD file.js",
		"npm test",
		"bash scripts/build.sh",
	]) {
		assert.equal(classify(cmd), null, cmd);
	}
});

test("pre-edit-protect asks before Edit/Write touches the guard's own files", () => {
	const script = hook("pre-edit-protect.mjs");
	for (const file of ["/r/.stack-agent/guard.config.json", "C:\\r\\.stack-agent\\guard-baseline.json", "/r/.stack-agent/bin/guard.mjs", "/r/.github/workflows/stack-agent.yml"]) {
		const r = runNode(script, [], { input: hookInput({ tool_name: "Edit", tool_input: { file_path: file } }) });
		assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "ask", file);
	}
	for (const file of ["/r/src/app.js", "/r/.stack-agent/verify.json", "/r/.stack-agent/api-map.md"]) {
		assert.equal(runNode(script, [], { input: hookInput({ tool_name: "Write", tool_input: { file_path: file } }) }).stdout, "", file);
	}
});

test("pre-bash hook also handles the PowerShell tool", () => {
	const r = runNode(hook("pre-bash.mjs"), [], { input: hookInput({ tool_name: "PowerShell", tool_input: { command: "git commit --no-verify -m x" }, cwd: copySample() }) });
	assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, "deny");
});

test("pre-bash hook prints a PreToolUse permission decision", () => {
	const r = runNode(hook("pre-bash.mjs"), [], { input: hookInput({ tool_name: "Bash", tool_input: { command: "git push --force" }, cwd: copySample() }) });
	assert.equal(r.code, 0);
	const out = JSON.parse(r.stdout);
	assert.equal(out.hookSpecificOutput.hookEventName, "PreToolUse");
	assert.equal(out.hookSpecificOutput.permissionDecision, "ask");
	const quiet = runNode(hook("pre-bash.mjs"), [], { input: hookInput({ tool_name: "Bash", tool_input: { command: "ls" } }) });
	assert.equal(quiet.stdout, "");
});

test("post-edit guard blocks an edit that adds a violation and names the fix", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", 'export const q = "SELECT * FROM items";\n');
	const r = runNode(hook("post-edit-guard.mjs"), [], { input: hookInput({ tool_name: "Edit", tool_input: { file_path: path.join(dir, "src/modules/items/controller.js") } }) });
	assert.equal(r.code, 2);
	assert.match(r.stderr, /\[no-sql-in-controller\]/);
	assert.match(r.stderr, /fix: move the query into/);
});

test("post-edit guard stays quiet for clean files, baselined files, and unguarded projects", () => {
	const dir = copySample();
	for (const file of [path.join(dir, "src/modules/items/service.js"), path.join(dir, "src/modules/reports/controller.js"), path.join(repoRoot, "README.md")]) {
		const r = runNode(hook("post-edit-guard.mjs"), [], { input: hookInput({ tool_name: "Write", tool_input: { file_path: file } }) });
		assert.equal(r.code, 0, `${file}: ${r.stderr}`);
	}
});

test("post-edit guard resolves a relative file_path against cwd", () => {
	const dir = copySample();
	write(dir, "src/modules/items/controller.js", 'import { table } from "../../db.js";\n');
	const r = runNode(hook("post-edit-guard.mjs"), [], { input: hookInput({ tool_name: "Edit", cwd: dir, tool_input: { file_path: "src/modules/items/controller.js" } }) });
	assert.equal(r.code, 2);
	assert.match(r.stderr, /\[controller-no-db\]/);
});

test("remind mode: stop hook blocks once when code changed without evidence", () => {
	const dir = copySample();
	useRemind(dir);
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	const input = hookInput({ hook_event_name: "Stop", cwd: dir });
	assert.equal(runNode(hook("stop-verify.mjs"), [], { input }).code, 0, "clean tree must not block");

	write(dir, "src/modules/items/service.js", fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8") + "\n");
	const first = runNode(hook("stop-verify.mjs"), [], { input });
	assert.equal(first.code, 2);
	assert.match(first.stderr, /there is no verify evidence yet/);
	assert.match(first.stderr, /src\/modules\/items\/service\.js/);
	assert.equal(runNode(hook("stop-verify.mjs"), [], { input }).code, 0, "same change set must not block twice");

	write(dir, "src/modules/items/repository.js", fs.readFileSync(path.join(dir, "src/modules/items/repository.js"), "utf8") + "\n");
	assert.equal(runNode(hook("stop-verify.mjs"), [], { input }).code, 2, "a new change set blocks again");
});

test("stop hook allows stopping when passing evidence is newer than the change", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	write(dir, "src/modules/items/service.js", "export const changed = true;\n");
	const later = new Date(Date.now() + 5000);
	write(dir, ".stack-agent/evidence/latest.json", JSON.stringify({ ok: true, full: true }));
	fs.utimesSync(path.join(dir, ".stack-agent/evidence/latest.json"), later, later);
	const input = hookInput({ hook_event_name: "Stop", cwd: dir });
	assert.equal(runNode(hook("stop-verify.mjs"), [], { input }).code, 0);

	write(dir, ".stack-agent/evidence/latest.json", JSON.stringify({ ok: true, full: false }));
	fs.utimesSync(path.join(dir, ".stack-agent/evidence/latest.json"), later, later);
	const partial = runNode(hook("stop-verify.mjs"), [], { input });
	assert.equal(partial.code, 2);
	assert.match(partial.stderr, /the latest verify run was partial/);
	assert.match(partial.stderr, /node \.stack-agent\/bin\/verify\.mjs/);

	write(dir, "src/modules/items/repository.js", "export const changedAgain = true;\n");
	write(dir, ".stack-agent/evidence/latest.json", JSON.stringify({ ok: false, full: true }));
	fs.utimesSync(path.join(dir, ".stack-agent/evidence/latest.json"), later, later);
	const failed = runNode(hook("stop-verify.mjs"), [], { input });
	assert.equal(failed.code, 2);
	assert.match(failed.stderr, /the latest verify run failed/);
});

test("remind mode: stop hook ignores docs-only changes, stop_hook_active, and projects without verify config", () => {
	const dir = copySample();
	useRemind(dir);
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	write(dir, "NOTES.md", "docs only\n");
	assert.equal(runNode(hook("stop-verify.mjs"), [], { input: hookInput({ cwd: dir }) }).code, 0);
	write(dir, "src/x.js", "export {};\n");
	assert.equal(runNode(hook("stop-verify.mjs"), [], { input: hookInput({ cwd: dir, stop_hook_active: true }) }).code, 0);
	assert.equal(runNode(hook("stop-verify.mjs"), [], { input: hookInput({ cwd: repoRoot }) }).code, 0);
});

test("hooks.json points at scripts that exist", () => {
	const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "hooks/hooks.json"), "utf8"));
	for (const groups of Object.values(config.hooks)) {
		for (const group of groups) {
			for (const h of group.hooks) {
				const rel = h.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/)[1];
				assert.ok(fs.existsSync(path.join(repoRoot, rel)), rel);
			}
		}
	}
});
