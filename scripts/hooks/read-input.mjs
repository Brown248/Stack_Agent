import fs from "node:fs";
import path from "node:path";

export function readHookInput() {
	const raw = fs.readFileSync(0, "utf8");
	try {
		return raw.trim() ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

export function findUp(startDir, relFile) {
	let dir = path.resolve(startDir);
	for (;;) {
		if (fs.existsSync(path.join(dir, relFile))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}
