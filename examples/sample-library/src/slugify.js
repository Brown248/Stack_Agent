import { foldAccents } from "./internal/normalize.js";

export function slugify(text, { separator = "-" } = {}) {
	if (typeof text !== "string") throw new TypeError("slugify expects a string");
	return foldAccents(text)
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean)
		.join(separator);
}

export function isSlug(text) {
	return typeof text === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text);
}
