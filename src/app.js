import http from "node:http";
import { routes } from "./routes.js";

export function createApp() {
	return http.createServer(async (req, res) => {
		res.json = (status, body) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		const url = new URL(req.url, "http://localhost");
		const match = routes.find((r) => r.method === req.method && r.path === url.pathname);
		if (!match) return res.json(404, { error: "not found" });
		try {
			req.body = await readBody(req);
		} catch {
			return res.json(400, { error: "invalid JSON body" });
		}
		match.handler(req, res);
	});
}

async function readBody(req) {
	let raw = "";
	for await (const chunk of req) raw += chunk;
	return raw ? JSON.parse(raw) : undefined;
}
