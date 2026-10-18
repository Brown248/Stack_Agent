import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { repoRoot } from "./helpers.mjs";

function routeTable(file) {
	const rows = {};
	for (const line of fs.readFileSync(path.join(repoRoot, file), "utf8").split("\n")) {
		const m = /^\| (Express|FastAPI|Flask[^|]*|Go net\/http[^|]*) \| `[^`]+` \| `(.+)` \| (.*)\|$/.exec(line);
		if (m) rows[m[1].split(" ")[0]] = { pattern: JSON.parse(m[2].replaceAll("\\|", "|")), method: /"method": "(\w+)"/.exec(m[3])?.[1] };
	}
	return rows;
}

const samples = {
	Express: ['router.get("/items", list)', "router.post('/items/:id', update)", ["GET", "/items"], ["POST", "/items/:id"]],
	FastAPI: ['@app.get("/items")', '@router.delete("/items/{item_id}")', ["GET", "/items"], ["DELETE", "/items/{item_id}"]],
	Flask: ['@app.route("/health")', '@bp.route("/users/<int:id>")', ["GET", "/health"], ["GET", "/users/<int:id>"]],
	Go: ['mux.HandleFunc("GET /items", listItems)', 'http.HandleFunc("POST /items/{id}", createItem)', ["GET", "/items"], ["POST", "/items/{id}"]],
};

for (const file of ["docs/adoption.md", "docs/th/adoption.md"]) {
	test(`the route regexes in ${file} match real code for each framework`, () => {
		const rows = routeTable(file);
		assert.deepEqual(Object.keys(rows).sort(), ["Express", "FastAPI", "Flask", "Go"]);
		for (const [name, [a, b, ...expected]] of Object.entries(samples)) {
			const { pattern, method } = rows[name];
			const re = new RegExp(pattern, "gm");
			const found = [...`${a}\n${b}\n`.matchAll(re)].map((m) => (method ? [method, m[1]] : [m[1].toUpperCase(), m[2]]));
			assert.deepEqual(found, expected, name);
		}
	});
}
