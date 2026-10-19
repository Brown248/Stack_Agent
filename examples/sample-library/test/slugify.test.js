import assert from "node:assert/strict";
import { test } from "node:test";
import { isSlug, slugify } from "../src/index.js";

test("slugify lowercases, folds accents, and joins words with a dash", () => {
	assert.equal(slugify("Crème Brûlée: A Recipe!"), "creme-brulee-a-recipe");
	assert.equal(slugify("  --Hello,   World--  "), "hello-world");
});

test("slugify takes a custom separator", () => {
	assert.equal(slugify("Hello World", { separator: "_" }), "hello_world");
});

test("slugify rejects non-strings", () => {
	assert.throws(() => slugify(42), /expects a string/);
});

test("isSlug accepts only lowercase dash-separated words", () => {
	assert.equal(isSlug("hello-world"), true);
	assert.equal(isSlug("Hello-World"), false);
	assert.equal(isSlug("hello--world"), false);
	assert.equal(isSlug(""), false);
});
