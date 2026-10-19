// usage: node job.mjs INPUT_CSV OUTPUT_CSV
// Reads an expenses CSV (date,category,amount), writes per-category totals, and prints them.
import fs from "node:fs";
import path from "node:path";
import { parseCsv, toCsv, totalsByCategory } from "./src/transform.js";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
	console.error("usage: node job.mjs INPUT_CSV OUTPUT_CSV");
	process.exit(2);
}

const csv = toCsv(totalsByCategory(parseCsv(fs.readFileSync(input, "utf8"))));
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, csv);
process.stdout.write(csv);
console.log(`wrote ${output} (${csv.trim().split("\n").length - 1} categories)`);
