import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sampleDir = path.join(repoRoot, "examples", "sample-backend");

export function copySample() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stack-agent-test-"));
	fs.cpSync(sampleDir, dir, {
		recursive: true,
		filter: (src) => !/[\\/]\.stack-agent[\\/](evidence|bin)([\\/]|$)/.test(src) && !/^data([\\/]|$)/.test(path.relative(sampleDir, src)),
	});
	return dir;
}

export function write(dir, rel, text) {
	const abs = path.join(dir, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, text);
}

export function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer();
		srv.once("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}

export function usePort(dir, port) {
	const file = path.join(dir, ".stack-agent/verify.json");
	const text = fs.readFileSync(file, "utf8").replaceAll("3999", String(port));
	fs.writeFileSync(file, text);
}

export function runNode(script, args = [], { cwd, input } = {}) {
	const r = spawnSync(process.execPath, [script, ...args], { cwd, input, encoding: "utf8" });
	return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function git(dir, ...args) {
	const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
	if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
	return r.stdout;
}
