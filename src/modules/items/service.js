import { insertItem, listItems } from "./repository.js";

export function createItem(input) {
	const name = typeof input?.name === "string" ? input.name.trim() : "";
	if (!name) return { error: "name is required" };
	return { item: insertItem(name) };
}

export function getItems() {
	return listItems();
}

export function itemCount() {
	return listItems().length;
}
