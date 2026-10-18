import { listItems } from "../items/repository.js";

export function summary(_req, res) {
	res.json(200, { itemCount: listItems().length });
}
