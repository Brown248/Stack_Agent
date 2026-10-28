// The hooks run this plugin's scripts and CI runs the copies in .stack-agent/bin, so a stale copy makes the two
// judge the same code differently. Used by the SessionStart hook to tell the human. Never throws.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { outdatedTools, pluginVersion } from "../init.mjs";
import { t } from "../lib/messages.mjs";

const initScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "init.mjs");

export function toolsMessage(root, lang = "en") {
	try {
		if (!fs.existsSync(path.join(root, ".stack-agent/bin"))) return null;
		const outdated = outdatedTools(root);
		if (!outdated.length) return null;
		let vendored = "unknown";
		try {
			vendored = fs.readFileSync(path.join(root, ".stack-agent/bin/VERSION"), "utf8").trim() || vendored;
		} catch {}
		const shown = outdated.slice(0, 4).join(", ") + (outdated.length > 4 ? ", ..." : "");
		return t(lang, "tools.differ", { vendored, plugin: pluginVersion(), shown, initScript, root });
	} catch {
		return null;
	}
}
