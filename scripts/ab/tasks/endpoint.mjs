// Task: add DELETE /items/:id to the sample backend and make sure it works.
import fs from "node:fs";
import path from "node:path";
import { call, commonGrade, sh, testDiff, withServer } from "../lib.mjs";

export const name = "endpoint";
export const prompt = "We need a way to remove items. Add DELETE /items/:id. It should return 204 when the item existed and 404 with an error body when it did not. Make sure it really works before you tell me it's done.";

// Independent HTTP probe: the harness starts the server itself, so the agent's own claims do not count.
export function probe(dir) {
	return withServer(dir, async (base) => {
		const created = await call(base, "POST", "/items", { name: "pen" });
		let id;
		try {
			id = JSON.parse(created.text).id;
		} catch {}
		const del = await call(base, "DELETE", `/items/${id}`);
		const again = await call(base, "DELETE", `/items/${id}`);
		const list = await call(base, "GET", "/items");
		const ok = created.status === 201 && del.status === 204 && again.status === 404 && /error/i.test(again.text) && !list.text.includes(`"id":${id},`);
		return { ok, detail: `create ${created.status}, delete ${del.status}, delete-again ${again.status} ${again.text.slice(0, 60)}` };
	});
}

export async function grade(dir) {
	const { checks, details } = commonGrade(dir);
	const behavior = await probe(dir);
	const g = { behavior: behavior.ok, ...checks };
	details.behavior = behavior.detail;
	g.testAdded = /DELETE/.test(testDiff(dir));
	g.mapOk = sh(process.execPath, [".stack-agent/bin/api-map.mjs"], dir).status === 0;
	const ctrl = fs.readFileSync(path.join(dir, "src/modules/items/controller.js"), "utf8");
	g.controllerThin = !/db\.js|SELECT\s|DELETE\s+FROM|prepare\(/.test(ctrl);
	return { checks: g, details };
}
