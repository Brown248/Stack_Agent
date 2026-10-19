import assert from "node:assert/strict";
import { test } from "node:test";
import { splitBill } from "../src/shared/format.js";

test("splitBill divides the total and rounds each share up to the cent", () => {
	assert.equal(splitBill(50, 4), "$12.50");
	assert.equal(splitBill(10, 3), "$3.34");
});

test("splitBill adds the tip before splitting", () => {
	assert.equal(splitBill(100, 2, 10), "$55.00");
});

test("splitBill rejects a bad total or head count", () => {
	assert.throws(() => splitBill(-1, 2), /total must be/);
	assert.throws(() => splitBill(10, 0), /people must be/);
	assert.throws(() => splitBill(10, 1.5), /people must be/);
});
