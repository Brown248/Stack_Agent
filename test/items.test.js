import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { createApp } from "../src/app.js";
import { connect, reset } from "../src/db.js";
import { up } from "../scripts/migrate.mjs";

let server;
let base;

before(async () => {
	up(connect(":memory:"));
	server = createApp().listen(0, "127.0.0.1");
	await new Promise((r) => server.once("listening", r));
	base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());
beforeEach(() => reset());

test("POST /items creates an item that GET /items returns", async () => {
	const created = await fetch(`${base}/items`, { method: "POST", body: JSON.stringify({ name: "pen" }) });
	assert.equal(created.status, 201);
	const listed = await (await fetch(`${base}/items`)).json();
	assert.deepEqual(listed.items.map((i) => i.name), ["pen"]);
});

test("POST /items rejects a missing name", async () => {
	const res = await fetch(`${base}/items`, { method: "POST", body: "{}" });
	assert.equal(res.status, 400);
});

test("GET /reports/summary counts items", async () => {
	await fetch(`${base}/items`, { method: "POST", body: JSON.stringify({ name: "a" }) });
	const body = await (await fetch(`${base}/reports/summary`)).json();
	assert.equal(body.itemCount, 1);
});
