import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { classify } from "../scripts/hooks/pre-bash.mjs";
import { copySample, git, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

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

test("pre-bash denies the forms git also accepts: abbreviated options, --config-env, git config, and hook env on push and merge", () => {
	for (const cmd of [
		// git takes any unambiguous prefix of a long option
		"git commit --no-verif -m x",
		"git commit --no-veri -m x",
		"git push --no-verif",
		"git merge --no-verify feat",
		"git am --no-verify x.patch",
		"git rebase --no-verify main",
		// --config-env reads the value from an environment variable
		"X=/dev/null git --config-env=core.hooksPath=X commit -m y",
		"git --config-env core.hooksPath=X commit -m y",
		"git -c core.hookspath= commit -m x",
		// a persistent setting turns the hooks off for every later command
		"git config core.hooksPath /dev/null",
		"git config --local core.hooksPath .nohooks",
		"git config set core.hooksPath x",
		"SKIP=guard git push",
		"LEFTHOOK=0 git merge feat",
	]) {
		assert.equal(classify(cmd)?.decision, "deny", cmd);
	}
	for (const cmd of ["git config --get core.hooksPath", "git config --unset core.hooksPath", "git config core.autocrlf false", "git config get core.hooksPath", "git commit --verbose -m x", "git push --verbose"])
		assert.equal(classify(cmd), null, cmd);
});

test("pre-bash asks for every other destructive form git accepts", () => {
	for (const cmd of [
		"git push --force-if-includes",
		"git push --force-w",
		"git push origin main:+main",
		"git push --m",
		"git push -d origin old",
		"git push --de origin old",
		"git push --prune origin",
		"git push --pru origin",
		"git reset --merge",
		"git reset --keep HEAD~1",
		"git reset --k HEAD~1",
		"git reset --ha HEAD~1",
		"git clean --f -d",
		"git checkout :/",
		"git restore *",
		"git stash drop",
	]) {
		assert.equal(classify(cmd)?.decision, "ask", cmd);
	}
	for (const cmd of ["git reset --soft HEAD~1", "git reset HEAD file.js", "git push --progress", "git push origin main", "git clean -n", "git restore --staged ."]) assert.equal(classify(cmd), null, cmd);
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

test("the after-edit guard also runs for NotebookEdit, which names its file notebook_path", () => {
	const matchers = JSON.parse(fs.readFileSync(path.join(repoRoot, "hooks/hooks.json"), "utf8")).hooks.PostToolUse.map((h) => h.matcher);
	assert.ok(matchers.some((m) => m.split("|").includes("NotebookEdit")), matchers.join(", "));
	const dir = copySample();
	write(dir, "notes/scratch.ipynb", JSON.stringify({ cells: [{ source: ["-----BEGIN PRIVATE KEY-----\n"] }] }));
	const r = runNode(hook("post-edit-guard.mjs"), [], { input: hookInput({ tool_name: "NotebookEdit", tool_input: { notebook_path: path.join(dir, "notes/scratch.ipynb") } }) });
	assert.equal(r.code, 2, r.stderr);
	assert.match(r.stderr, /notes\/scratch\.ipynb:1 \[no-private-keys\]/);
});

test("post-bash guard reports a violation a shell command wrote, once, and leaves earlier dirt alone", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	// the human's own uncommitted violation, there before the session: recorded as the session's starting dirt
	write(dir, "src/modules/orders/controller.js", 'export const q = "SELECT * FROM orders";\n');
	assert.equal(runNode(hook("session-start.mjs"), [], { input: hookInput({ hook_event_name: "SessionStart", cwd: dir, session_id: "s1" }) }).code, 0);
	const input = hookInput({ tool_name: "Bash", cwd: dir, session_id: "s1", tool_input: { command: "sed -i ..." } });
	assert.equal(runNode(hook("post-bash-guard.mjs"), [], { input }).code, 0, "files dirty before the session are not the command's doing");

	write(dir, "src/modules/items/controller.js", 'export const q = "SELECT * FROM items";\n');
	const r = runNode(hook("post-bash-guard.mjs"), [], { input });
	assert.equal(r.code, 2, r.stderr);
	assert.match(r.stderr, /that command changed files that now break rules/);
	assert.match(r.stderr, /src\/modules\/items\/controller\.js:1 \[no-sql-in-controller\][\s\S]*fix: move the query into/);
	assert.doesNotMatch(r.stderr, /orders/);
	assert.equal(runNode(hook("post-bash-guard.mjs"), [], { input }).code, 0, "an unchanged file is not reported again");

	write(dir, "src/modules/orders/controller.js", 'export const q = "SELECT * FROM orders"; // touched\n');
	const touched = runNode(hook("post-bash-guard.mjs"), [], { input });
	assert.equal(touched.code, 2, "a pre-existing file the command changed is checked");
	assert.match(touched.stderr, /orders\/controller\.js:1 \[no-sql-in-controller\]/);
	assert.doesNotMatch(touched.stderr, /items\/controller/, "reported once already");
});

test("post-bash guard skips files the after-edit hook already checked, and projects without a guard", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	write(dir, "src/modules/items/controller.js", 'export const q = "SELECT * FROM items";\n');
	const edit = runNode(hook("post-edit-guard.mjs"), [], { input: hookInput({ tool_name: "Edit", cwd: dir, session_id: "s2", tool_input: { file_path: "src/modules/items/controller.js" } }) });
	assert.equal(edit.code, 2);
	assert.equal(runNode(hook("post-bash-guard.mjs"), [], { input: hookInput({ tool_name: "Bash", cwd: dir, session_id: "s2", tool_input: { command: "npm test" } }) }).code, 0, "reported by the edit hook already");
	assert.equal(runNode(hook("post-bash-guard.mjs"), [], { input: hookInput({ tool_name: "Bash", cwd: repoRoot, session_id: "s2", tool_input: { command: "ls" } }) }).code, 0);
});

test("hooks.json runs the post-bash guard after Bash and PowerShell", () => {
	const post = JSON.parse(fs.readFileSync(path.join(repoRoot, "hooks/hooks.json"), "utf8")).hooks.PostToolUse;
	const entry = post.find((e) => e.hooks.some((h) => h.command.includes("post-bash-guard.mjs")));
	assert.deepEqual(entry?.matcher.split("|").sort(), ["Bash", "PowerShell"]);
});

test("the after-edit and after-shell guards leave out what the guard config ignores, as CI does", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	write(dir, "test/fixtures/key.pem", "-----BEGIN PRIVATE KEY-----\n");
	assert.equal(runNode(hook("post-edit-guard.mjs"), [], { input: hookInput({ tool_name: "Write", cwd: dir, session_id: "ig", tool_input: { file_path: "test/fixtures/key.pem" } }) }).code, 0);
	assert.equal(runNode(hook("post-bash-guard.mjs"), [], { input: hookInput({ tool_name: "Bash", cwd: dir, session_id: "ig2", tool_input: { command: "cp a b" } }) }).code, 0);
});

test("files left dirty before the session are not blamed on a command or on the session, docs included", () => {
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	// a conflict marker in a doc the human left half-merged; the Stop hook's fingerprint leaves *.md out, the guard does not
	write(dir, "docs/notes.md", "intro\n<<<<<<< HEAD\nmine\n=======\ntheirs\n>>>>>>> other\n");
	assert.equal(runNode(hook("session-start.mjs"), [], { input: hookInput({ hook_event_name: "SessionStart", cwd: dir, session_id: "md" }) }).code, 0);
	const bash = hookInput({ tool_name: "Bash", cwd: dir, session_id: "md", tool_input: { command: "ls" } });
	assert.equal(runNode(hook("post-bash-guard.mjs"), [], { input: bash }).code, 0, "ls changed nothing");
	write(dir, "src/modules/items/service.js", fs.readFileSync(path.join(dir, "src/modules/items/service.js"), "utf8") + "\n");
	const stop = runNode(hook("stop-verify.mjs"), [], { input: hookInput({ hook_event_name: "Stop", cwd: dir, session_id: "md" }) });
	assert.doesNotMatch(stop.stderr, /notes\.md/, "the Stop hook's guard leaves the human's file out too");
});

test("blobIds hashes every file it can, even when one in the batch cannot be read", async () => {
	const { blobIds } = await import("../scripts/hooks/session-record.mjs");
	const dir = copySample();
	git(dir, "init", "-q");
	const ids = blobIds(dir, ["src/app.js", "gone/missing.js", "src/server.js"]);
	assert.deepEqual([...ids.keys()].sort(), ["src/app.js", "src/server.js"]);
	assert.match(ids.get("src/app.js"), /^[0-9a-f]{40}$/);
	if (process.platform !== "win32") {
		write(dir, '"quoted.js', "x\n");
		assert.ok(blobIds(dir, ['"quoted.js', "src/app.js"]).has('"quoted.js'), "a name git would unquote is hashed on its own");
	}
});

test("after-edit hooks running at the same time keep every entry, and the after-shell hook reports none of them again", async () => {
	const { spawn } = await import("node:child_process");
	const dir = copySample();
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	const files = Array.from({ length: 8 }, (_, i) => `src/modules/m${i}/controller.js`);
	for (const f of files) write(dir, f, 'export const q = "SELECT * FROM t";\n');
	const run = (f) =>
		new Promise((resolve) => {
			const child = spawn(process.execPath, [hook("post-edit-guard.mjs")], { stdio: ["pipe", "ignore", "ignore"] });
			child.on("close", resolve);
			child.stdin.end(hookInput({ tool_name: "Write", cwd: dir, session_id: "par", tool_input: { file_path: f } }));
		});
	await Promise.all(files.map(run));
	const { readSeen } = await import("../scripts/hooks/session-record.mjs");
	assert.deepEqual(Object.keys(readSeen(dir, "par")).filter((f) => files.includes(f)).sort(), [...files].sort());
	assert.equal(runNode(hook("post-bash-guard.mjs"), [], { input: hookInput({ tool_name: "Bash", cwd: dir, session_id: "par", tool_input: { command: "npm test" } }) }).code, 0);
});

test("the after-shell guard reaches a monorepo project when the command runs at the top of the repository", () => {
	const top = tempDir("stack-agent-mono-");
	fs.cpSync(copySample(), path.join(top, "apps", "api"), { recursive: true });
	write(top, "README.md", "monorepo\n");
	git(top, "init", "-q");
	git(top, "add", "-A");
	git(top, "commit", "-qm", "base");
	write(top, "apps/api/src/modules/items/controller.js", 'export const q = "SELECT * FROM items";\n');
	write(top, "tools/loose.js", "-----BEGIN PRIVATE KEY-----\n");
	const r = runNode(hook("post-bash-guard.mjs"), [], { input: hookInput({ tool_name: "Bash", cwd: top, session_id: "mono", tool_input: { command: "sed -i ..." } }) });
	assert.equal(r.code, 2, r.stderr);
	assert.match(r.stderr, /apps\/api\/src\/modules\/items\/controller\.js:1 \[no-sql-in-controller\]/);
	assert.doesNotMatch(r.stderr, /loose\.js/, "a file outside every project has no guard config");
});

test("pre-edit-protect lets setup fill in a guard config or workflow that init wrote and git has never seen, and asks otherwise", () => {
	const script = hook("pre-edit-protect.mjs");
	const decision = (dir, rel, tool = "Edit") => {
		const out = runNode(script, [], { input: hookInput({ tool_name: tool, cwd: dir, tool_input: { file_path: rel } }) }).stdout;
		return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "allow";
	};
	// a library with no Stack Agent yet, committed; init writes the templates
	const dir = tempDir("stack-agent-setup-");
	write(dir, "package.json", JSON.stringify({ name: "lib", type: "module", scripts: { test: "node --test" } }));
	write(dir, "src/index.js", "export const x = 1;\n");
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	assert.equal(runNode(path.join(repoRoot, "scripts", "init.mjs"), [dir, "--preset", "library"]).code, 0);
	const config = ".stack-agent/guard.config.json";
	const workflow = ".github/workflows/stack-agent.yml";
	for (const rel of [config, workflow]) assert.match(fs.readFileSync(path.join(dir, rel), "utf8"), /EDIT ME/, `${rel} is a template`);

	assert.equal(decision(dir, config), "allow", "untracked, with EDIT ME: setup fills it in");
	assert.equal(decision(dir, workflow, "Write"), "allow");
	assert.equal(decision(dir, path.join(dir, config)), "allow", "an absolute path works the same");
	assert.equal(decision(dir, ".stack-agent/guard-baseline.json", "Write"), "ask", "the baseline is never a template");
	assert.equal(decision(dir, ".stack-agent/bin/guard.mjs"), "ask", "nor are the tools");

	// placeholders gone: the config now says something, so editing it asks
	const filled = fs.readFileSync(path.join(dir, config), "utf8").replaceAll("EDIT ME", "done");
	fs.writeFileSync(path.join(dir, config), filled);
	assert.equal(decision(dir, config), "ask");
	fs.writeFileSync(path.join(dir, config), filled.replace("done", "EDIT ME"));

	// staged, committed, or committed and then unstaged: git has seen it, so it asks
	git(dir, "add", config);
	assert.equal(decision(dir, config), "ask", "staged");
	git(dir, "commit", "-qm", "setup");
	assert.equal(decision(dir, config), "ask", "committed");
	git(dir, "rm", "-q", "--cached", config);
	assert.equal(decision(dir, config), "ask", "unstaged but still in HEAD");

	// outside git nothing tells a fresh template from a config in use
	const loose = tempDir("stack-agent-setup-");
	write(loose, config, '{ "rules": [], "note": "EDIT ME" }\n');
	assert.equal(decision(loose, config), "ask");
	// a guard config Write would create from nothing is not a template init wrote
	assert.equal(decision(tempDir("stack-agent-setup-"), config, "Write"), "ask");
});

test("a shell write to the guard config or workflow still asks, and points setup at Edit or Write", () => {
	const hint = /use the Edit or Write tool instead/;
	for (const cmd of [`node -e "require('fs').writeFileSync('.stack-agent/guard.config.json','{}')"`, "sed -i s/x/y/ .github/workflows/stack-agent.yml"]) {
		const r = classify(cmd);
		assert.equal(r?.decision, "ask", cmd);
		assert.match(r.reason, hint, cmd);
	}
	const baseline = classify("sed -i s/1/5/ .stack-agent/guard-baseline.json");
	assert.equal(baseline?.decision, "ask");
	assert.doesNotMatch(baseline.reason, hint, "the baseline is never a template");
});

test("pre-bash denies the other ways git is told to skip its hooks: GIT_CONFIG_* env, exported hook-disabling env, and aliases", () => {
	for (const cmd of [
		"GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x",
		'GIT_CONFIG_PARAMETERS="core.hookspath=/dev/null" git commit -m x',
		"export GIT_CONFIG_PARAMETERS=core.hookspath=/dev/null; git commit -m x",
		"export HUSKY=0; git commit -m x",
		'git -c alias.ci="commit --no-verify" ci -m x',
		'git -c alias.c="commit -n" c',
		'git config alias.ci "commit --no-verify"',
		'git config alias.pushit "push --no-verify"',
	])
		assert.equal(classify(cmd)?.decision, "deny", cmd);
});

test("pre-bash asks before the repo's local git hooks are changed, and leaves reading them and .husky alone", () => {
	for (const cmd of ["echo exit 0 > .git/hooks/pre-commit", "chmod -x .git/hooks/pre-commit", "rm .git/hooks/pre-commit", "mv .git/hooks .git/h", `node -e "require('fs').writeFileSync('.git/hooks/pre-commit','exit 0')"`]) {
		const r = classify(cmd);
		assert.equal(r?.decision, "ask", cmd);
		assert.match(r.reason, /local git hooks/);
	}
	// outside a Stack Agent project the repo's gates are not Stack Agent's business
	assert.equal(classify("rm .git/hooks/pre-commit", 0, () => null, { inProject: false }), null);
});

test("pre-bash does not ask about ordinary commands, also with quoted values glued to a name", () => {
	for (const cmd of [
		"cat .git/hooks/pre-commit",
		"ls .git/hooks",
		"git status",
		"git log -n 5 --oneline",
		'git commit -m "fix: the --no-verify docs" ',
		"git commit -m 'msg with -n inside'",
		'git config alias.st status',
		'git config alias.lg "log -n 5"',
		'git -c user.name="Ada Lovelace" commit -m x',
		'git -c color.ui="always" diff',
		"HUSKY=0 npm test",
		"export PATH=$PATH:/x",
		"export NODE_ENV=production",
		"sed -i s/a/b/ .husky/pre-commit",
		"ls .github/hooks-docs",
		'echo "a b" > out.txt',
		"npm run build && git add -A",
		'FOO="a b" node script.js',
	])
		assert.equal(classify(cmd), null, cmd);
});

test("pre-edit-protect asks before Edit/Write changes a local git hook, in a Stack Agent project only", () => {
	const script = hook("pre-edit-protect.mjs");
	const decision = (cwd, file) => {
		const out = runNode(script, [], { input: hookInput({ tool_name: "Write", cwd, tool_input: { file_path: file } }) }).stdout;
		return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "allow";
	};
	const dir = copySample();
	git(dir, "init", "-q");
	assert.equal(decision(dir, ".git/hooks/pre-commit"), "ask");
	assert.equal(decision(dir, path.join(dir, ".git", "hooks", "commit-msg")), "ask");
	assert.equal(decision(dir, "src/app.js"), "allow");
	assert.equal(decision(dir, ".husky/pre-commit"), "allow", ".husky is committed and reviewed");
	assert.equal(decision(tempDir("stack-agent-nohooks-"), ".git/hooks/pre-commit"), "allow", "not a Stack Agent project");
});
