// Rough edges found installing Stack Agent into its first real project (a pnpm + Next.js monorepo, 2026-10-24).
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { test } from "node:test";
import { loadVerifyConfig, runVerify } from "../scripts/verify.mjs";
import { freePort, git, repoRoot, runNode, tempDir, write } from "./helpers.mjs";

const initScript = path.join(repoRoot, "scripts", "init.mjs");
const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), "utf8");
const workflow = (dir) => read(dir, ".github/workflows/stack-agent.yml");

test("filling the feature map's placeholder row is enough: the template's own instructions do not count as EDIT ME", () => {
	const dir = tempDir("stack-agent-init-");
	runNode(initScript, [dir, "--preset", "cli"]);
	const map = read(dir, ".stack-agent/feature-map.md").replace(/^\| EDIT ME.*$/m, "| run it | cli.js | `node cli.js` | - |");
	write(dir, ".stack-agent/feature-map.md", map);
	assert.doesNotMatch(runNode(initScript, [dir, "--check"]).stdout, /feature-map\.md: still has EDIT ME/);
});

test("init adds .stack-agent/ to .prettierignore when the project uses prettier, once, and leaves other projects alone", () => {
	const withConfig = tempDir("stack-agent-init-");
	write(withConfig, ".prettierrc.json", "{}\n");
	assert.match(runNode(initScript, [withConfig]).stdout, /created {2}\.prettierignore \(\+ \.stack-agent\/,/);
	assert.equal(read(withConfig, ".prettierignore"), ".stack-agent/\n");
	assert.match(runNode(initScript, [withConfig]).stdout, /kept {5}\.prettierignore/);
	assert.equal(read(withConfig, ".prettierignore"), ".stack-agent/\n", "the line must not repeat");

	const withIgnore = tempDir("stack-agent-init-");
	write(withIgnore, ".prettierignore", "node_modules");
	write(withIgnore, ".eslintignore", "dist\n");
	runNode(initScript, [withIgnore]);
	assert.equal(read(withIgnore, ".prettierignore"), "node_modules\n.stack-agent/\n");
	assert.equal(read(withIgnore, ".eslintignore"), "dist\n.stack-agent/\n");

	const inPackageJson = tempDir("stack-agent-init-");
	write(inPackageJson, "package.json", JSON.stringify({ name: "x", prettier: { semi: false } }));
	runNode(initScript, [inPackageJson]);
	assert.equal(read(inPackageJson, ".prettierignore"), ".stack-agent/\n");

	const none = tempDir("stack-agent-init-");
	runNode(initScript, [none]);
	assert.ok(!fs.existsSync(path.join(none, ".prettierignore")));
	assert.ok(!fs.existsSync(path.join(none, ".eslintignore")));
});

test("--check notes an ESLint flat config that would lint the vendored tools, until it ignores .stack-agent", () => {
	const dir = tempDir("stack-agent-init-");
	write(dir, "eslint.config.mjs", 'export default [{ ignores: ["dist/**"] }];\n');
	runNode(initScript, [dir]);
	assert.match(runNode(initScript, [dir, "--check"]).stdout, /notes[\s\S]*eslint\.config\.mjs does not mention \.stack-agent/);
	write(dir, "eslint.config.mjs", 'export default [{ ignores: ["dist/**", ".stack-agent/**"] }];\n');
	assert.doesNotMatch(runNode(initScript, [dir, "--check"]).stdout, /eslint\.config\.mjs does not mention/);
});

test("the workflow runs the Node version the project asks for, never below 22", () => {
	const engines = tempDir("stack-agent-init-");
	write(engines, "package.json", JSON.stringify({ engines: { node: ">=24.11.0" } }));
	runNode(initScript, [engines]);
	const versions = [...workflow(engines).matchAll(/node-version: (\S+)/g)].map((m) => m[1]);
	assert.deepEqual([...new Set(versions)], ["24"]);
	assert.ok(versions.length >= 2, "both jobs");

	const nvmrc = tempDir("stack-agent-init-");
	write(nvmrc, ".nvmrc", "v26.1.0\n");
	write(nvmrc, "package.json", JSON.stringify({ engines: { node: ">=20" } }));
	runNode(initScript, [nvmrc]);
	assert.match(workflow(nvmrc), /node-version: 26$/m, ".nvmrc names one version and wins over engines");

	const older = tempDir("stack-agent-init-");
	write(older, "package.json", JSON.stringify({ engines: { node: "^18" } }));
	runNode(initScript, [older]);
	assert.equal(workflow(older), read(repoRoot, "templates/ci/stack-agent.yml"), "Stack Agent itself needs 22");

	const named = tempDir("stack-agent-init-");
	write(named, ".nvmrc", "lts/*\n");
	runNode(initScript, [named]);
	assert.equal(workflow(named), read(repoRoot, "templates/ci/stack-agent.yml"));
});

test("--check notes a workflow whose node-version is older than the project's", () => {
	const dir = tempDir("stack-agent-init-");
	write(dir, ".github/workflows/stack-agent.yml", read(repoRoot, "templates/ci/stack-agent.yml"));
	write(dir, "package.json", JSON.stringify({ engines: { node: ">=24" } }));
	runNode(initScript, [dir]);
	assert.match(runNode(initScript, [dir, "--check"]).stdout, /sets node-version 22, but the project asks for Node 24/);
});

test("without origin/HEAD, a single origin/main or origin/master is taken as the default branch", () => {
	const dir = tempDir();
	git(dir, "init", "-q", "-b", "work");
	write(dir, "README", "x\n");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "first");
	git(dir, "update-ref", "refs/remotes/origin/master", "HEAD");
	runNode(initScript, [dir]);
	assert.match(workflow(dir), /^ {4}branches: \["master"\]$/m);
	// a guess, so --check keeps saying so until origin/HEAD is set (an old origin/main can sit next to a "develop" default)
	assert.match(runNode(initScript, [dir, "--check"]).stdout, /there is no origin\/HEAD, so the default branch was taken to be master/);
	git(dir, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master");
	assert.doesNotMatch(runNode(initScript, [dir, "--check"]).stdout, /origin\/HEAD/);

	// origin/main/feature is not origin/main
	const nested = tempDir();
	git(nested, "init", "-q");
	write(nested, "README", "x\n");
	git(nested, "add", "-A");
	git(nested, "commit", "-qm", "first");
	git(nested, "update-ref", "refs/remotes/origin/main/feature", "HEAD");
	runNode(initScript, [nested]);
	assert.match(runNode(initScript, [nested, "--check"]).stdout, /default branch is not known yet/);

	const both = tempDir();
	git(both, "init", "-q");
	write(both, "README", "x\n");
	git(both, "add", "-A");
	git(both, "commit", "-qm", "first");
	git(both, "update-ref", "refs/remotes/origin/master", "HEAD");
	git(both, "update-ref", "refs/remotes/origin/main", "HEAD");
	runNode(initScript, [both]);
	assert.match(runNode(initScript, [both, "--check"]).stdout, /default branch is not known yet \(no origin\/HEAD\)[^\n]*git remote set-head origin --auto/);
});

test("http checks can see a redirect itself (followRedirects: false) and match response headers", async () => {
	const port = await freePort();
	const server = http
		.createServer((req, res) => {
			if (req.url === "/dashboard") res.writeHead(307, { location: "/login?next=%2Fdashboard" }).end();
			else res.writeHead(200, { "content-type": "text/html" }).end("<form>login</form>");
		})
		.listen(port, "127.0.0.1");
	try {
		const dir = tempDir();
		write(
			dir,
			".stack-agent/verify.json",
			JSON.stringify({
				baseUrl: `http://127.0.0.1:${port}`,
				checks: [
					{ name: "redirects", method: "GET", path: "/dashboard", followRedirects: false, expectStatus: 307, expectHeaders: { location: "/login" } },
					{ name: "follows", method: "GET", path: "/dashboard", expectStatus: 200, expectBodyIncludes: "login" },
					{ name: "wrong-header", method: "GET", path: "/dashboard", followRedirects: false, expectStatus: 307, expectHeaders: { location: "/home", "x-missing": "a" } },
				],
			}),
		);
		const config = loadVerifyConfig(path.join(dir, ".stack-agent/verify.json"));
		const steps = await runVerify({ root: dir, config });
		const by = Object.fromEntries(steps.map((s) => [s.name, s]));
		assert.equal(by.redirects.ok, true, JSON.stringify(by.redirects.problems));
		assert.equal(by.follows.ok, true, JSON.stringify(by.follows.problems));
		assert.equal(by["wrong-header"].ok, false);
		assert.deepEqual(by["wrong-header"].problems, ['location header "/login?next=%2Fdashboard" does not include "/home"', "no x-missing header"]);
	} finally {
		server.close();
	}
});

test("followRedirects and expectHeaders are validated", () => {
	const dir = tempDir();
	const load = (check) => {
		write(dir, ".stack-agent/verify.json", JSON.stringify({ baseUrl: "http://127.0.0.1:1", checks: [{ name: "c", method: "GET", path: "/", expectStatus: 200, ...check }] }));
		return () => loadVerifyConfig(path.join(dir, ".stack-agent/verify.json"));
	};
	assert.throws(load({ followRedirects: "no" }), /followRedirects must be true or false/);
	assert.throws(load({ expectHeaders: ["location"] }), /expectHeaders must map a header name/);
	assert.throws(load({ expectHeaders: { location: 1 } }), /expectHeaders must map a header name/);
	assert.doesNotThrow(load({ followRedirects: false, expectHeaders: { location: "/login" } }));
});

test("a feature map finished under 0.4.0 still has the old instruction sentence, and --check does not count it", () => {
	const dir = tempDir("stack-agent-init-");
	runNode(initScript, [dir, "--preset", "cli"]);
	const old = read(dir, ".stack-agent/feature-map.md")
		.replace("replace the placeholder row below, and leave", "replace every EDIT ME, and leave")
		.replace(/^\| EDIT ME.*$/m, "| run it | cli.js | `node cli.js` | - |");
	write(dir, ".stack-agent/feature-map.md", old);
	assert.match(old, /replace every EDIT ME/);
	assert.doesNotMatch(runNode(initScript, [dir, "--check"]).stdout, /feature-map\.md: still has EDIT ME/);
});

test("prettier as a plain dependency counts; other spellings, a deliberate !.stack-agent, and CRLF files are respected", () => {
	const dep = tempDir("stack-agent-init-");
	write(dep, "package.json", JSON.stringify({ devDependencies: { prettier: "^3" }, scripts: { "format:check": "prettier --check ." } }));
	runNode(initScript, [dep]);
	assert.equal(read(dep, ".prettierignore"), ".stack-agent/\n");

	for (const line of ["**/.stack-agent/**", ".stack-agent/*", "/.stack-agent", "!.stack-agent/"]) {
		const dir = tempDir("stack-agent-init-");
		write(dir, ".prettierignore", `dist\n${line}\n`);
		assert.match(runNode(initScript, [dir]).stdout, /kept {5}\.prettierignore/, line);
		assert.equal(read(dir, ".prettierignore"), `dist\n${line}\n`, line);
	}

	const crlf = tempDir("stack-agent-init-");
	write(crlf, ".prettierignore", "dist\r\nbuild");
	runNode(initScript, [crlf]);
	assert.equal(read(crlf, ".prettierignore"), "dist\r\nbuild\r\n.stack-agent/\r\n");
});

test("in a monorepo subfolder, the repository top's .nvmrc, Prettier, and ESLint config count too", () => {
	const top = tempDir();
	git(top, "init", "-q");
	write(top, ".nvmrc", "# team version\n24\n");
	write(top, ".prettierrc", "{}\n");
	write(top, "eslint.config.mjs", "export default [];\n");
	write(top, "apps/web/package.json", JSON.stringify({ name: "web" }));
	const web = path.join(top, "apps/web");
	assert.equal(runNode(initScript, [web]).code, 0);
	assert.match(read(top, ".github/workflows/stack-agent-apps-web.yml"), /node-version: 24$/m);
	assert.equal(read(top, ".prettierignore"), ".stack-agent/\n", "a root `prettier --check .` reads only the root ignore file");
	assert.ok(!fs.existsSync(path.join(web, ".prettierignore")), "the subfolder has no Prettier config of its own");
	assert.match(runNode(initScript, [web, "--check"]).stdout, /\.\.\/\.\.\/eslint\.config\.mjs does not mention \.stack-agent/);
});

test("engines.node ranges give their real lower bound, or nothing when they have none", () => {
	for (const [range, expected] of [
		[">=24.11.0", "24"],
		[">=24 || ^22", null],
		["<25", null],
		["*", null],
		[">=26 <27", "26"],
	]) {
		const dir = tempDir("stack-agent-init-");
		write(dir, "package.json", JSON.stringify({ engines: { node: range } }));
		runNode(initScript, [dir]);
		const versions = [...new Set([...workflow(dir).matchAll(/node-version: (\S+)/g)].map((m) => m[1]))];
		assert.deepEqual(versions, [expected ?? "22"], range);
	}
});

test("--check notes a node-version older than Stack Agent needs even when the project names none, and reads past a comment", () => {
	const dir = tempDir("stack-agent-init-");
	write(dir, ".github/workflows/stack-agent.yml", read(repoRoot, "templates/ci/stack-agent.yml").replace(/node-version: 22$/m, "node-version: 18 # old pin"));
	runNode(initScript, [dir]);
	assert.match(runNode(initScript, [dir, "--check"]).stdout, /sets node-version 18, but Stack Agent's scripts need Node 22/);
});

test("expectHeaders rejects an invalid header name when the config loads", () => {
	const dir = tempDir();
	write(dir, ".stack-agent/verify.json", JSON.stringify({ baseUrl: "http://127.0.0.1:1", checks: [{ name: "c", method: "GET", path: "/", expectStatus: 200, expectHeaders: { "x bad": "a" } }] }));
	assert.throws(() => loadVerifyConfig(path.join(dir, ".stack-agent/verify.json")), /invalid header name "x bad"/);
});

test("vendored tools checked out with CRLF (git core.autocrlf on Windows) are the same tools, and init keeps them LF", () => {
	const dir = tempDir("stack-agent-init-");
	assert.match(runNode(initScript, [dir]).stdout, /created {2}\.stack-agent\/\.gitattributes/);
	assert.match(read(dir, ".stack-agent/.gitattributes"), /^\* text eol=lf$/m);
	const tool = path.join(dir, ".stack-agent/bin/guard.mjs");
	fs.writeFileSync(tool, fs.readFileSync(tool, "utf8").replace(/\n/g, "\r\n"));
	const check = runNode(initScript, [dir, "--check"]);
	assert.doesNotMatch(check.stdout, /outdated/);
	assert.match(runNode(initScript, [dir]).stdout, /unchanged \.stack-agent\/bin\/guard\.mjs/);
	assert.doesNotMatch(runNode(initScript, [dir]).stdout, /\.gitattributes/, "written once");

	write(dir, ".stack-agent/bin/guard.mjs", "// old\r\n");
	assert.match(runNode(initScript, [dir, "--check"]).stdout, /outdated: \.stack-agent\/bin\/guard\.mjs/, "a real change still counts");
});

test("the CI workflow gets a read-only token", () => {
	const dir = tempDir("stack-agent-init-");
	runNode(initScript, [dir]);
	assert.match(workflow(dir), /^permissions:\n {2}contents: read$/m);
});

test("every preset's no-private-keys rule catches encrypted and PGP keys too", () => {
	for (const preset of ["generic", "backend-http", "cli", "library", "frontend-web"]) {
		const { rules } = JSON.parse(read(repoRoot, `templates/presets/${preset}/guard.config.json`));
		const re = new RegExp(rules.find((r) => r.id === "no-private-keys").pattern, "m");
		for (const key of ["-----BEGIN PRIVATE KEY-----", "-----BEGIN RSA PRIVATE KEY-----", "-----BEGIN ENCRYPTED PRIVATE KEY-----", "-----BEGIN PGP PRIVATE KEY BLOCK-----"])
			assert.match(key, re, `${preset}: ${key}`);
		assert.doesNotMatch("-----BEGIN PUBLIC KEY-----", re, preset);
	}
});

test("the against worktree links workspace packages' node_modules, so their tests do not fail there for a missing package", () => {
	const dir = tempDir();
	// a workspace package whose test needs a dependency installed in the package's own node_modules (pnpm layout)
	write(dir, "packages/core/node_modules/dep/index.js", "module.exports = 41;\n");
	write(dir, "packages/core/src/answer.js", "module.exports = require('dep') + 1;\n");
	write(dir, "packages/core/src/answer.test.js", "const assert = require('node:assert');\nassert.strictEqual(require('./answer.js'), 42);\n");
	write(dir, ".gitignore", "node_modules/\n.stack-agent/evidence/\n");
	write(dir, ".stack-agent/verify.json", JSON.stringify({ test: { args: ["node", "packages/core/src/answer.test.js"] }, evidenceDir: ".stack-agent/evidence" }));
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	// a refactor of the code and its test: the test passes on the old code too, so the against step must skip, not
	// "detect" (without the package's node_modules linked, require('dep') failed there and read as detection)
	write(dir, "packages/core/src/answer.js", "const base = require('dep');\nmodule.exports = base + 1;\n");
	write(dir, "packages/core/src/answer.test.js", "const assert = require('node:assert');\nassert.strictEqual(require('./answer.js'), 40 + 2);\n");
	const r = runNode(path.join(repoRoot, "scripts", "verify.mjs"), ["--root", dir]);
	assert.equal(r.code, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /SKIP against: the changed tests also pass on the code at HEAD/);
	assert.doesNotMatch(r.stdout, /fail\(s\) on the code before the change/);
});

test("defaultLinks finds node_modules one and two levels down, but not inside node_modules or dot folders", async () => {
	const { defaultLinks } = await import("../scripts/verify.mjs");
	const dir = tempDir();
	for (const d of ["node_modules/x/node_modules", "apps/web/node_modules", "tool/node_modules", ".cache/a/node_modules", "packages/core/src"]) fs.mkdirSync(path.join(dir, d), { recursive: true });
	assert.deepEqual(defaultLinks(dir).sort(), ["apps/web/node_modules", "node_modules", "tool/node_modules"]);
});
