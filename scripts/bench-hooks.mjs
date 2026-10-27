#!/usr/bin/env node
// Times the code fingerprint, the Stop hook, the after-shell guard hook, and the against step's checkout on synthetic
// git repos.
// Not part of npm test and not vendored by init.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { codeFingerprint } from "./lib/fingerprint.mjs";
import { ConfigError, parseArgs } from "./lib/files.mjs";
import { createWorktree, removeWorktree } from "./verify.mjs";

const USAGE = `usage: node scripts/bench-hooks.mjs [--files N...] [--sparse] [--keep]
  builds a git repo of N small JS files (default 20000) for each N and prints, as JSON lines: the fingerprint of a
  clean tree and with 1,000 changed files (median of 3), the Stop hook end to end with a session record (median
  of 3), the after-shell guard hook with 5 and with 1,000 changed files (median of 3, the steady state after its
  first check), and the time and size of the against step's checkout and its removal
  --sparse  put the project in app/ (100 files) beside the N files, and also time the against step's checkout with
            against.paths (only the project's folder), as a monorepo would
  --keep  leave the repos on disk and print where`;

const here = path.dirname(fileURLToPath(import.meta.url));
const git = (cwd, ...a) => execFileSync("git", ["-c", "user.name=b", "-c", "user.email=b@b", "-c", "core.autocrlf=false", ...a], { cwd, stdio: "pipe", maxBuffer: 1 << 30 });
const timed = (f) => {
	const s = performance.now();
	const r = f();
	return [Math.round(performance.now() - s), r];
};
const median = (f, n = 3) => Array.from({ length: n }, () => timed(f)[0]).sort((a, b) => a - b)[Math.floor(n / 2)];

function sizeOf(dir) {
	let size = 0;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		size += e.isDirectory() ? sizeOf(p) : fs.statSync(p).size;
	}
	return size;
}

function bench(dir, n, sparse) {
	for (let i = 0; i < n; i++) {
		const sub = path.join(dir, "src", `m${Math.floor(i / 100)}`);
		if (i % 100 === 0) fs.mkdirSync(sub, { recursive: true });
		fs.writeFileSync(path.join(sub, `f${i}.js`), `export const v${i} = ${i};\n`);
	}
	fs.mkdirSync(path.join(dir, ".stack-agent"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".stack-agent/verify.json"), JSON.stringify({ test: { command: "node -e 0" } }));
	fs.writeFileSync(path.join(dir, ".stack-agent/guard.config.json"), JSON.stringify({ rules: [{ id: "no-forbidden", type: "pattern", files: ["src/**"], pattern: "FORBIDDEN", message: "m", fix: "f" }] }));
	if (sparse) for (let i = 0; i < 100; i++) {
		fs.mkdirSync(path.join(dir, "app/src"), { recursive: true });
		fs.writeFileSync(path.join(dir, "app/src", `a${i}.js`), `export const a${i} = ${i};
`);
	}
	git(dir, "init", "-q");
	git(dir, "add", "-A");
	git(dir, "commit", "-qm", "base");
	const clean = median(() => codeFingerprint(dir));
	const postBash = () => spawnSync(process.execPath, [path.join(here, "hooks/post-bash-guard.mjs")], { input: JSON.stringify({ cwd: dir, session_id: "bench-bash" }), encoding: "utf8" });
	for (let i = 0; i < 5; i++) fs.appendFileSync(path.join(dir, "src/m0", `f${i}.js`), "// shell edit\n");
	postBash();
	const postBash5 = median(postBash);
	for (let i = 0; i < Math.min(1000, n); i++) fs.appendFileSync(path.join(dir, "src", `m${Math.floor(i / 100)}`, `f${i}.js`), "// edit\n");
	const changed = median(() => codeFingerprint(dir));
	postBash();
	const postBash1000 = median(postBash);
	fs.mkdirSync(path.join(dir, ".stack-agent/evidence/sessions"), { recursive: true });
	fs.writeFileSync(path.join(dir, ".stack-agent/evidence/sessions/bench.start.json"), JSON.stringify({ at: new Date().toISOString(), fingerprint: "before", head: null, dirty: {}, stopHook: "block", stopHookIgnore: ["**/*.md", ".stack-agent/**", "docs/**"], evidenceDir: ".stack-agent/evidence", againstOff: false }));
	const hook = median(() => spawnSync(process.execPath, [path.join(here, "hooks/stop-verify.mjs")], { input: JSON.stringify({ cwd: dir, session_id: "bench" }), encoding: "utf8" }));
	const [checkout, made] = timed(() => createWorktree(dir, "HEAD", { link: [] }));
	const mb = +(sizeOf(path.join(made.tmp, "wt")) / 1048576).toFixed(1);
	const [remove] = timed(() => removeWorktree(made.top, made.tmp, made.links));
	const out = { files: n, fingerprintCleanMs: clean, fingerprint1000ChangedMs: changed, stopHookMs: hook, postBashGuard5ChangedMs: postBash5, postBashGuard1000ChangedMs: postBash1000, againstCheckoutMs: checkout, checkoutMB: mb, againstRemoveMs: remove };
	if (sparse) {
		const app = path.join(dir, "app");
		const [sparseCheckout, s] = timed(() => createWorktree(app, "HEAD", { link: [], paths: [] }));
		if (s.error) throw new Error(s.error);
		const [sparseRemove] = timed(() => removeWorktree(s.top, s.tmp, s.links));
		Object.assign(out, { sparseCheckoutMs: sparseCheckout, sparseRemoveMs: sparseRemove });
	}
	return out;
}

function main(argv) {
	const args = parseArgs(argv, { flags: ["keep", "sparse", "help"], multi: ["files"] });
	if (args.help) return console.log(USAGE);
	const sizes = (args.files ?? ["20000"]).map(Number);
	if (!sizes.every((n) => Number.isInteger(n) && n > 0)) throw new ConfigError("--files takes positive integers");
	for (const n of sizes) {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-agent-bench-hooks-"));
		try {
			console.log(JSON.stringify({ ...bench(dir, n, args.sparse), node: process.version, platform: process.platform }));
		} finally {
			if (args.keep) console.log(`repo kept at ${dir}`);
			else fs.rmSync(dir, { recursive: true, force: true });
		}
	}
}

try {
	main(process.argv.slice(2));
} catch (err) {
	if (!(err instanceof ConfigError)) throw err;
	console.error(`${err.message}\n${USAGE}`);
	process.exitCode = 2;
}
