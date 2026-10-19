import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "../src/server/server.js";

async function withServer(fn) {
	const server = createServer();
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		await fn(`http://127.0.0.1:${server.address().port}`);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

test("the server serves the page and the shared code", () =>
	withServer(async (base) => {
		const page = await fetch(base + "/");
		assert.equal(page.status, 200);
		assert.match(await page.text(), /<main id="app">/);
		const shared = await fetch(base + "/shared/format.js");
		assert.equal(shared.status, 200);
		await shared.text();
	}));

test("the server never serves server code or files outside its two folders", () =>
	withServer(async (base) => {
		for (const p of ["/server/server.js", "/%2e%2e/server/server.js", "/shared/%2e%2e/server/server.js", "/shared/..%2fserver/server.js"]) {
			const res = await fetch(base + p);
			assert.equal(res.status, 404, p);
			await res.text();
		}
	}));
