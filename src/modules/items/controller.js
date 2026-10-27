import { createItem, getItems } from "./service.js";

export function list(_req, res) {
	res.json(200, { items: getItems() });
}

export function create(req, res) {
	const result = createItem(req.body);
	if (result.error) return res.json(400, { error: result.error });
	res.json(201, result.item);
}
