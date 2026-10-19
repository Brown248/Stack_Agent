// End-to-end check without a browser: load the page from the running server, follow every module it
// loads, and run the served shared code. Needs BASE_URL, e.g. http://127.0.0.1:3999
const base = process.env.BASE_URL;
if (!base) throw new Error("set BASE_URL to the running dev server");

const failures = [];
const expect = (ok, message) => ok || failures.push(message);

async function get(url) {
	const res = await fetch(new URL(url, base));
	return { status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text() };
}

const page = await get("/");
expect(page.status === 200, `GET / returned ${page.status}`);
expect(page.text.includes('<main id="app">'), 'the page has no <main id="app">');

// browsers refuse to run a module script unless it is served as JavaScript, so check every one the page reaches
const seen = new Set();
const queue = [...page.text.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => new URL(m[1], base).href);
expect(queue.length > 0, "the page loads no module script");
while (queue.length) {
	const url = queue.shift();
	if (seen.has(url)) continue;
	seen.add(url);
	const mod = await get(url);
	const where = new URL(url).pathname;
	expect(mod.status === 200, `GET ${where} returned ${mod.status}`);
	expect(/^text\/javascript\b/.test(mod.type), `${where} is served as "${mod.type}", so browsers will not run it as a module`);
	for (const m of mod.text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) queue.push(new URL(m[1], url).href);
}

const shared = await get("/shared/format.js");
const { splitBill } = await import("data:text/javascript," + encodeURIComponent(shared.text));
const share = splitBill(50, 4);
expect(share === "$12.50", `the served splitBill(50, 4) gave ${share}, expected $12.50`);

if (failures.length) {
	console.error(failures.map((f) => "e2e: " + f).join("\n"));
	process.exitCode = 1;
} else console.log(`e2e: ok (${seen.size} module(s) served as JavaScript; 50 split 4 ways is ${share})`);
