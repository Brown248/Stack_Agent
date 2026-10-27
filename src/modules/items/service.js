import { insertItem, listItems } from "./repository.js";

export function createItem(input) {
	const name = typeof input?.name === "string" ? input.name.trim() : "";
	if (!name) return { error: "name is required" };
	if (name.length > 50) return { error: "name must be at most 50 characters" };
	return { item: insertItem(name) };
}

export function getItems() {
	return listItems();
}
