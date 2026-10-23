// against.paths: the against step checks out only the project's folder (and the folders listed) instead of the
// whole repository, for monorepos where the full checkout is the slow part.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createWorktree, loadVerifyConfig, removeWorktree, runAgainst } from "../scripts/verify.mjs";
import { git, tempDir, write } from "./helpers.mjs";

// a repository with the project in app/, a shared folder it imports, and a large folder it does not need
function monorepo() {
	const top = tempDir("stack-agent-sparse-");
	write(top, "README.md", "top\n");
	write(top, "shared/money.js", "export const cents = (s) => Math.round(Number(s) * 100);\n");
	for (let i = 0; i < 20; i++) write(top, `other/big/f${i}.js`, `export const v${i} = ${i};\n`);
	write(top, "app/src/x.js", 'import { cents } from "../../shared/money.js";\nexport const x = cents("1.00");\n');
	write(top, "app/.stack-agent/verify.json", JSON.stringify({ checks: [{ name: "old", args: ["node", "-e", "0"] }] }));
	git(top, "init", "-q");
	git(top, "add", "-A");
	git(top, "commit", "-qm", "base");
	return { top, app: path.join(top, "app") };
}

test("with paths, only the project's folder, the listed folders, and the top-level files are checked out", () => {
	const { app } = monorepo();
	const made = createWorktree(app, "HEAD", { link: [], paths: ["../shared"] });
	assert.equal(made.error, undefined, made.error);
	try {
		const wt = path.join(made.tmp, "wt");
		assert.ok(fs.existsSync(path.join(made.wtRoot, "src/x.js")), "the project");
		assert.ok(fs.existsSync(path.join(wt, "shared/money.js")), "a listed folder");
		assert.ok(fs.existsSync(path.join(wt, "README.md")), "top-level files come with cone mode");
		assert.ok(!fs.existsSync(path.join(wt, "other")), "an unlisted folder is left out");
	} finally {
		removeWorktree(made.top, made.tmp, made.links);
	}
});

test("without paths the whole repository is checked out, as before", () => {
	const { app } = monorepo();
	const made = createWorktree(app, "HEAD", { link: [] });
	try {
		assert.ok(fs.existsSync(path.join(made.tmp, "wt", "other/big/f0.js")));
	} finally {
		removeWorktree(made.top, made.tmp, made.links);
	}
});

test("a path outside the repository is refused", () => {
	const { app } = monorepo();
	const made = createWorktree(app, "HEAD", { link: [], paths: ["../../elsewhere"] });
	assert.match(made.error, /against\.paths: \.\.\/elsewhere is outside the repository/);
	removeWorktree(made.top, made.tmp, made.links ?? []);
});

test("the against step detects a new check in a sparse checkout", async () => {
	const { app } = monorepo();
	write(app, "src/x.js", 'import { cents } from "../../shared/money.js";\nexport const x = cents("2.00");\n');
	const config = {
		checks: [
			{ name: "old", args: ["node", "-e", "0"] },
			{ name: "two-dollars", args: ["node", "--input-type=module", "-e", "import { x } from './src/x.js'; process.exit(x === 200 ? 0 : 1)"] },
		],
		against: { paths: ["../shared"] },
	};
	const step = await runAgainst({ root: app, config, ref: "HEAD" });
	assert.deepEqual(step.detecting, ["two-dollars"], JSON.stringify(step));
});

test("against.paths must be an array of strings", () => {
	const dir = tempDir("stack-agent-sparse-cfg-");
	write(dir, "v.json", JSON.stringify({ checks: [{ name: "a", args: ["node", "-e", "0"] }], against: { paths: "shared" } }));
	assert.throws(() => loadVerifyConfig(path.join(dir, "v.json")), /against\.paths must be an array of strings/);
});
