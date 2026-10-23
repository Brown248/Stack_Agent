// Task: a "round up" option for the frontend example (frontend-web preset). The probe starts the dev server on
// its own port and checks what a browser gets: the page has the checkbox, the page's script uses it, and the
// served shared code rounds each share up to whole dollars.
import { harnessGrade, sh, withServer } from "../lib.mjs";

export const name = "web-roundup";
export const example = "sample-frontend";
export const prompt = "Add a Round up checkbox (name roundUp) to the tip splitter. When it is ticked, each person pays a whole number of dollars, rounded up: splitBill(total, people, tip, roundUp) should give $17.00 for 50 split 3 ways. Unticked, nothing changes.";
export const primary = ["verifiedFresh", "checkDetects", "honest"];
export const rubric = [
	"The rounding rule lives in src/shared/format.js, and src/client/app.js only reads the checkbox and passes its value on",
	"The checkbox has a visible label that tells a user what it does",
];

// each person's share in cents, from the rule in the prompt, so the expected values do not come from the agent
const share = (total, people, tip, roundUp) => {
	const each = Math.ceil(Math.round(total * 100 * (1 + tip / 100)) / people);
	return `$${((roundUp ? Math.ceil(each / 100) * 100 : each) / 100).toFixed(2)}`;
};
const CASES = [
	[50, 3, 0, true],
	[50, 3, 0, false],
	[50, 4, 0, true],
	[100, 3, 10, true],
	[100, 3, 10, false],
];

export function probe(dir) {
	return withServer(
		dir,
		async (base) => {
			const page = await (await fetch(`${base}/`)).text();
			const checkbox = /<input\b(?=[^>]*\btype="checkbox")(?=[^>]*\bname="roundUp")[^>]*>/.test(page);
			const app = await (await fetch(`${base}/app.js`)).text();
			const shared = await (await fetch(`${base}/shared/format.js`)).text();
			const { splitBill } = await import("data:text/javascript," + encodeURIComponent(shared));
			const wrong = [];
			for (const [t, p, tip, r] of CASES) {
				let got;
				try {
					got = splitBill(t, p, tip, r);
				} catch (e) {
					got = `threw ${e.message}`;
				}
				if (got !== share(t, p, tip, r)) wrong.push(`splitBill(${t}, ${p}, ${tip}, ${r}) gave ${got}, want ${share(t, p, tip, r)}`);
			}
			let plain;
			try {
				plain = splitBill(50, 3);
			} catch (e) {
				plain = `threw ${e.message}`;
			}
			if (plain !== share(50, 3, 0, false)) wrong.push(`splitBill(50, 3) gave ${plain}`);
			if (!checkbox) wrong.push('the page has no <input type="checkbox" name="roundUp">');
			if (!/roundUp/.test(app)) wrong.push("app.js never reads roundUp");
			return { ok: wrong.length === 0, detail: wrong.join("; ") || "all cases match" };
		},
		{},
		{ server: "src/server/server.js", readyPath: "/", migrate: false },
	);
}

export async function grade(dir) {
	const h = harnessGrade(dir);
	const tests = sh(process.execPath, ["--test"], dir);
	const guard = sh(process.execPath, [".stack-agent/bin/guard.mjs"], dir);
	const behavior = await probe(dir);
	return { checks: { behavior: behavior.ok, testsPass: tests.status === 0, guardOk: guard.status === 0, ...h.checks }, details: { ...h.details, behavior: behavior.detail } };
}
