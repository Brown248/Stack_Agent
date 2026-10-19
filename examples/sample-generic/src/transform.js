// Pure functions: text in, text out. File access and printing live in job.mjs.

export function parseCsv(text) {
	const [header, ...lines] = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
	const columns = header.split(",").map((c) => c.trim());
	return lines.map((line, i) => {
		const cells = line.split(",");
		if (cells.length !== columns.length) throw new Error(`row ${i + 2} has ${cells.length} cells, expected ${columns.length}`);
		return Object.fromEntries(columns.map((c, j) => [c, cells[j].trim()]));
	});
}

// amounts are summed in cents so 0.1 + 0.2 stays exact
export function totalsByCategory(rows) {
	const cents = new Map();
	rows.forEach((row, i) => {
		if (!/^-?\d+(\.\d{1,2})?$/.test(row.amount ?? "")) throw new Error(`row ${i + 2} has a bad amount: ${JSON.stringify(row.amount)}`);
		const [whole, frac = ""] = row.amount.replace("-", "").split(".");
		const value = (Number(whole) * 100 + Number(frac.padEnd(2, "0"))) * (row.amount.startsWith("-") ? -1 : 1);
		cents.set(row.category, (cents.get(row.category) ?? 0) + value);
	});
	return [...cents].map(([category, total]) => ({ category, cents: total })).sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category));
}

export function toCsv(totals) {
	const money = (c) => (c < 0 ? "-" : "") + `${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
	return ["category,total", ...totals.map((t) => `${t.category},${money(t.cents)}`)].join("\n") + "\n";
}
