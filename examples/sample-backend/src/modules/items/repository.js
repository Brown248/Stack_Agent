import { db } from "../../db.js";

export function insertItem(name) {
	return db().prepare("INSERT INTO items (name) VALUES (?) RETURNING id, name").get(name);
}

export function listItems() {
	return db().prepare("SELECT id, name FROM items ORDER BY id").all();
}
