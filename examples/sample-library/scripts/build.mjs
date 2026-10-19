// Copies src/ to dist/, then loads dist/ the way package.json "exports" points consumers at it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_EXPORTS = ["isSlug", "slugify"];

const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, "src"), dist, { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const entry = path.join(root, pkg.exports["."]);
try {
	const api = await import(pathToFileURL(entry).href);
	const names = Object.keys(api).sort();
	if (names.join() !== EXPECTED_EXPORTS.join()) throw new Error(`exports are [${names.join(", ")}], expected [${EXPECTED_EXPORTS.join(", ")}]`);
	console.log(`built dist/ (exports: ${names.join(", ")})`);
} catch (err) {
	console.error(`build: dist/ is broken: ${err.message}`);
	process.exitCode = 1;
}
