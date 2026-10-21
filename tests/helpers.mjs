import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const sampleDir = path.join(repoRoot, "examples", "sample-backend");

const created = [];
process.on("exit", () => {
	if (process.env.STACK_AGENT_KEEP_TEMP) return;
	for (const dir of created) {
		try {
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		} catch {}
	}
});

export function tempDir(prefix = "stack-agent-test-") {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	created.push(dir);
	return dir;
}

export function copyExample(name) {
	const from = path.join(repoRoot, "examples", name);
	const dir = tempDir(`stack-agent-${name}-`);
	fs.cpSync(from, dir, {
		recursive: true,
		filter: (src) => !/[\\/]\.stack-agent[\\/](evidence|bin)([\\/]|$)/.test(src) && !/[\\/]__pycache__([\\/]|$)/.test(src),
	});
	return dir;
}

export function copySample() {
	const dir = tempDir();
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

// A process that verify killed is gone once kill(pid, 0) fails. Under a loaded machine killing a process tree takes
// a while, and a process killed before it started never writes its pid file, so poll instead of sleeping a fixed time.
export async function processGone(pidFile, { timeoutMs = 10000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (fs.existsSync(pidFile)) {
			const pid = Number(fs.readFileSync(pidFile, "utf8"));
			try {
				process.kill(pid, 0);
			} catch (err) {
				if (err.code === "ESRCH") return true;
				throw err;
			}
		}
		await new Promise((res) => setTimeout(res, 100));
	}
	// never wrote its pid: it was killed before it got that far
	return !fs.existsSync(pidFile);
}
