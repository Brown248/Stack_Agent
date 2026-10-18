import * as items from "./modules/items/controller.js";
import * as reports from "./modules/reports/controller.js";

export const routes = [
	route("GET", "/health", (_req, res) => res.json(200, { status: "ok" })),
	route("GET", "/items", items.list),
	route("POST", "/items", items.create),
	route("GET", "/reports/summary", reports.summary),
];

function route(method, path, handler) {
	return { method, path, handler };
}
