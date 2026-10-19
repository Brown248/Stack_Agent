// Dev server: serves src/client/ at / and src/shared/ at /shared/. Nothing under src/server/ is ever served.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = [
	["/shared/", path.join(src, "shared")],
	["/", path.join(src, "client")],
];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

export function resolveFile(urlPath) {
	const clean = new URL(urlPath, "http://localhost").pathname;
	const [prefix, dir] = ROOTS.find(([p]) => clean.startsWith(p));
	const file = path.resolve(dir, decodeURIComponent(clean.slice(prefix.length)) || "index.html");
	return file.startsWith(dir + path.sep) ? file : null;
}

export function createServer() {
	return http.createServer((req, res) => {
		const file = resolveFile(req.url);
		if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found\n");
			return;
		}
		res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
		fs.createReadStream(file).pipe(res);
	});
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const port = Number(process.env.PORT ?? 3000);
	createServer().listen(port, "127.0.0.1", () => console.log(`serving http://127.0.0.1:${port}/`));
}
