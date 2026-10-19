import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv, toCsv, totalsByCategory } from "../src/transform.js";

test("parseCsv reads rows by header and skips blank lines and a BOM", () => {
	assert.deepEqual(parseCsv("﻿date,category,amount\r\n2026-01-01,food,1.50\r\n\r\n"), [{ date: "2026-01-01", category: "food", amount: "1.50" }]);
});

test("parseCsv rejects a row with the wrong number of cells", () => {
	assert.throws(() => parseCsv("a,b\n1,2,3\n"), /row 2 has 3 cells, expected 2/);
});

test("totalsByCategory sums in cents and sorts by total, largest first", () => {
	const rows = [
		{ category: "food", amount: "0.10" },
		{ category: "food", amount: "0.20" },
		{ category: "travel", amount: "5" },
	];
	assert.deepEqual(totalsByCategory(rows), [
		{ category: "travel", cents: 500 },
		{ category: "food", cents: 30 },
	]);
});

test("totalsByCategory rejects an amount that is not money", () => {
	assert.throws(() => totalsByCategory([{ category: "x", amount: "12.345" }]), /row 2 has a bad amount: "12.345"/);
});

test("toCsv writes a header and two-decimal totals", () => {
	assert.equal(toCsv([{ category: "travel", cents: 20050 }, { category: "refund", cents: -5 }]), "category,total\ntravel,200.50\nrefund,-0.05\n");
});
