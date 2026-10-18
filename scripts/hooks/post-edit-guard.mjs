#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { compareToBaseline, loadConfig, runGuard } from "../guard.mjs";
import { ConfigError, readJson, toPosix } from "../lib/files.mjs";
import { findUp, readHookInput } from "./read-input.mjs";

const CONFIG = ".stack-agent/guard.config.json";

const input = readHookInput();
const filePath = input.tool_input?.file_path;
if (filePath) {
	const absFile = path.resolve(input.cwd ?? process.cwd(), filePath);
	const root = findUp(path.dirname(absFile), CONFIG);
	if (root) {
		try {
			const config = loadConfig(path.join(root, CONFIG));
			const baselinePath = path.resolve(root, config.baseline ?? ".stack-agent/guard-baseline.json");
			const baseline = fs.existsSync(baselinePath) ? readJson(baselinePath, "guard baseline").counts ?? {} : {};
			const rel = toPosix(path.relative(root, absFile));
			const violations = runGuard({ root, config, files: [rel] });
			const { failing } = compareToBaseline(violations, baseline, [rel]);
			if (failing.length) {
				const keys = new Set(failing.map((f) => `${f.rule}|${f.file}`));
				const lines = violations
					.filter((v) => keys.has(`${v.rule}|${v.file}`))
					.map((v) => `${v.file}:${v.line} [${v.rule}] ${v.message}\n  found: ${v.detail}\n  fix: ${v.fix}`);
				process.stderr.write(`stack-agent guard: your edit added rule violations. Fix them now.\n${lines.join("\n")}\n`);
				process.exitCode = 2;
			}
		} catch (err) {
			if (!(err instanceof ConfigError)) throw err;
			process.stderr.write(`stack-agent guard: config error: ${err.message}\n`);
			process.exitCode = 1;
		}
	}
}
