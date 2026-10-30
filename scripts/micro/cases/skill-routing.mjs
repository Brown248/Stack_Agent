// Does the model pick the right skill from the descriptions alone? Claude Code lists every skill the model may invoke
// as "name: description" and the model decides from that line; a description that fails to name the job, or claims a
// neighbour's, sends the model to the wrong skill or to none. Idea from revfactory/harness (Apache 2.0), whose skill
// tests keep "should trigger" and "near-miss" prompts for each description.
//
// One call carries all the requests (`ITEMS`) and asks for the skill each would load first, so the score is the share
// answered as expected (0 to 1) and a run costs one call. Each request is judged on its own: the model is told to
// treat it as the only message of a new session. The listing is the shipped one, read from skills/*/SKILL.md, minus
// the skills that set disable-model-invocation (Claude Code does not show those to the model), so the case measures
// what ships. Variants: `current` (name and description), `names-only` (no descriptions: what the descriptions add),
// `crowded` and `crowded-names-only` (the same among the skills of other plugins), and the control, which is told no skills exist (it can only be right on the requests that need none).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "skills");
const PLUGIN = "stack-agent";

export function shippedSkills(dir = SKILLS_DIR) {
	const out = [];
	for (const name of fs.readdirSync(dir).sort()) {
		const file = path.join(dir, name, "SKILL.md");
		if (!fs.existsSync(file)) continue;
		const text = fs.readFileSync(file, "utf8");
		const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
		const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? "";
		const hidden = /^disable-model-invocation:\s*true\s*$/m.test(front);
		out.push({ name, description: description.replace(/^"(.*)"$/, "$1"), hidden });
	}
	return out;
}

const listing = (skills, withDescriptions) =>
	skills
		.filter((s) => !s.hidden)
		.map((s) => `- ${PLUGIN}:${s.name}${withDescriptions ? `: ${s.description}` : ""}`)
		.join("\n");

// Skills of other plugins that sit in the same listing in a real session, with the descriptions they had in a Claude
// Code session on 2026-10-29. Several claim neighbouring work (debugging, tests, database migrations, QA), which is
// where a description has to win the request. They may have changed since; the point is a realistic crowd, not these
// exact words.
export const DISTRACTORS = [
	{ name: "superpowers:systematic-debugging", description: "Use when encountering any bug, test failure, or unexpected behavior, before proposing fixes" },
	{ name: "superpowers:test-driven-development", description: "Use when implementing any feature or bugfix, before writing implementation code" },
	{ name: "superpowers:brainstorming", description: "You MUST use this before any creative work - creating features, building components, adding functionality, modifying behavior, or planning anything new, in software or out of it (a talk, a business, a renovation)." },
	{ name: "superpowers:writing-plans", description: "Use when you have a spec or requirements for a multi-step task, before touching code" },
	{ name: "supabase-postgres", description: "Specialized in database schema design, Row Level Security (RLS) policies, query optimization, connection pooling, and PL/pgSQL database triggers. Use when writing database migrations, writing RLS policies, indexing slow queries, or developing server-side DB functions." },
	{ name: "nextjs-optimizer", description: "Orchestrates Next.js performance tuning, App Router optimization (RSC/RCC separation), Core Web Vitals improvement (LCP, INP, CLS), and edge caching. Use when reducing bundle sizes, configuring ISR, or diagnosing web vitals regression." },
	{ name: "security-audit", description: "Security guidance and vulnerability review for codebases, APIs, services, CLI tools, libraries, and daemons. Use for security questions, focused reviews, vulnerability research, security audits, or pen tests. Run the complete workflow only for explicit codebase audit or pen-test requests, full/comprehensive/end-to-end reviews, or requested report artifacts." },
	{ name: "data:sql-queries", description: "Write correct, performant SQL across all major data warehouse dialects (Snowflake, BigQuery, Databricks, PostgreSQL, etc.). Use when writing queries, optimizing slow SQL, translating between dialects, or building complex analytical queries with CTEs, window functions, or aggregations." },
	{ name: "data:validate-data", description: "QA an analysis before sharing -- methodology, accuracy, and bias checks. Use when reviewing an analysis before a stakeholder presentation, spot-checking calculations and aggregation logic, verifying a SQL query's results look right, or assessing whether conclusions are actually supported by the data." },
	{ name: "anthropic-skills:senior-qa-engineer", description: "Act as a senior QA/SDET: plan tests, design test cases, write reliable Playwright/API/performance tests, triage bugs, fix flaky tests, and review test quality." },
	{ name: "simplify", description: "Review the changed code for reuse, simplification, efficiency, and altitude cleanups, then apply the fixes. Quality only — it does not hunt for bugs; use /code-review for that." },
];
const OTHERS = new Set(DISTRACTORS.map((d) => d.name.replace(/^.*:/, "")));

const crowded = (skills, withDescriptions) =>
	[listing(skills, withDescriptions), ...DISTRACTORS.map((d) => (withDescriptions ? `- ${d.name}: ${d.description}` : `- ${d.name}`))].join("\n");

// ok: the skills that are a right first load; ["none"] when no skill should be loaded. A request that two skills
// could serve names both; a request that one description claims outright names only that one.
export const ITEMS = [
	// debug: a bug report, before reading code
	{ request: "POST /items returns 201 even when the name is empty. It should be 400.", ok: ["debug"] },
	{ request: "ทำไม export CSV ถึงขึ้น error 500 ตลอดเลย", ok: ["debug"] },
	{ request: "the totals say 1 instead of 2 after I add a second item, can you find and fix it", ok: ["debug"] },
	{ request: "แก้บั๊กให้หน่อย รายการที่สร้างแล้วไม่โผล่ในลิสต์", ok: ["debug"] },
	// verify: prove a change works
	{ request: "I think the change is done. Prove it works before I merge.", ok: ["verify"] },
	{ request: "เช็กว่าใช้ได้จริงไหม ก่อนส่งงาน", ok: ["verify"] },
	{ request: "run the checks and tell me whether the new rule really works", ok: ["verify"] },
	{ request: "ยิง API ดูหน่อยว่า endpoint ใหม่ตอบถูกไหม", ok: ["verify"] },
	// add-endpoint
	{ request: "Add DELETE /items/:id that removes an item and returns 204.", ok: ["add-endpoint"] },
	{ request: "เพิ่ม endpoint ดึงรายงานสรุปรายเดือนให้หน่อย", ok: ["add-endpoint"] },
	{ request: "we need a new route for health checks", ok: ["add-endpoint"] },
	{ request: "make a new API that returns the orders of one user", ok: ["add-endpoint"] },
	// add-migration
	{ request: "add a nullable notes column to the items table", ok: ["add-migration"] },
	{ request: "ทำ migration เพิ่มตาราง tags ให้หน่อย", ok: ["add-migration"] },
	{ request: "change the schema so users.email is unique", ok: ["add-migration"] },
	{ request: "add an index on orders.created_at", ok: ["add-migration"] },
	// api-map: where an endpoint lives, and keeping the map in sync
	{ request: "which file handles GET /reports/summary?", ok: ["api-map"] },
	{ request: "where does POST /orders end up, and what does it call?", ok: ["api-map"] },
	{ request: "I just added the route /ping by hand, keep the API map in sync with it", ok: ["api-map"] },
	{ request: "ไฟล์ไหนจัดการ endpoint /users/:id", ok: ["api-map"] },
	// feature-map: where a user-facing thing lives (a CLI, a web app, a library)
	{ request: "where is the --top flag handled in this CLI?", ok: ["feature-map"] },
	{ request: "which part of the code is behind the Settings page toggle?", ok: ["feature-map"] },
	{ request: "I renamed the --limit option, update the feature map", ok: ["feature-map"] },
	{ request: "ปุ่มดาวน์โหลดรายงานอยู่ในโค้ดตรงไหน", ok: ["feature-map"] },
	// near-misses: close to a skill's words and not its job, or a job only a person can start (those skills are not
	// in the listing: reflect, correct, sample-review, stack-agent-init, run-evals, mine-corrections)
	{ request: "explain what a database index is and when it helps", ok: ["none"] },
	{ request: "explain how the migration system in this repo works, I only want to understand it", ok: ["none"] },
	{ request: "rename the variable x to count in utils.js", ok: ["none"] },
	{ request: "summarize this README for me in three lines", ok: ["none"] },
	{ request: "ช่วยอธิบายว่า REST กับ GraphQL ต่างกันยังไง", ok: ["none"] },
	{ request: "write a unit test for the slugify function", ok: ["none"] },
	{ request: "สุ่มตรวจ commit ที่ agent merge วันนี้ให้หน่อย", ok: ["none"] },
	{ request: "set up Stack Agent in this repo", ok: ["none"] },
	{ request: "turn this review comment into a guard rule so it cannot happen again", ok: ["none"] },
	{ request: "what do you think of the name 'repository.js' for the data layer?", ok: ["none"] },
];

const NONE = /^(none|no skill|no skills?|n\/a|nothing|-)$/i;

// "3: stack-agent:debug", "3. **debug**", "3) none" -> { 3: "debug", ... }; the plugin prefix and markdown are dropped
export function parseAnswers(text) {
	const answers = {};
	for (const line of String(text).split("\n")) {
		const m = /^\W*(\d{1,3})\W{0,3}\s*[:.)\-–]?\s*(.+?)\s*$/.exec(line);
		if (!m) continue;
		const first = m[2].replace(/[*`_]/g, "").split(/\s+(?:[-–—(]|because)/)[0].trim().split(/[\s,;]/)[0];
		const name = first.replace(/^.*:/, "").replace(/[.]+$/, "").toLowerCase();
		if (name && !(m[1] in answers)) answers[Number(m[1])] = NONE.test(name) ? "none" : name;
	}
	return answers;
}

// Is `answer` (a skill's short name, or "none") an acceptable first load for `item`? A request that needs none of ours is
// also answered right by another plugin's skill. In a text answer the other skills are the ones listed in DISTRACTORS;
// in a live session (routing-live.mjs) they are whatever else is loaded, so `otherSkill` can say so.
export function isRight(item, answer, { otherSkill = (a) => OTHERS.has(a) } = {}) {
	if (item.ok.includes(answer)) return true;
	return item.ok.includes("none") && typeof answer === "string" && otherSkill(answer);
}

// the share of requests answered with an acceptable first skill; a missing or unknown answer is wrong
export function scoreAnswers(text, items = ITEMS) {
	const answers = parseAnswers(text);
	// a request that needs none of ours is also answered right by another plugin's skill: what is measured is that
	// Stack Agent's own skills are neither missed nor loaded for the wrong job
	const right = items.filter((item, i) => isRight(item, answers[i + 1])).length;
	return right / items.length;
}

const skills = shippedSkills();

export default {
	description: "From the skill descriptions alone, does the model pick the right skill as its first load for each request, and none for the near-misses?",
	better: "higher",
	variants: {
		control: null,
		current: listing(skills, true),
		"names-only": listing(skills, false),
		// the same, among the skills of other plugins that claim neighbouring work
		crowded: crowded(skills, true),
		"crowded-names-only": crowded(skills, false),
	},
	prompt: (guidance) =>
		[
			"You are a coding agent in a project that uses the Stack Agent plugin.",
			guidance ? `These are the skills you may load with the Skill tool, one per line:\n${guidance}` : "No skills are available to load.",
			`Below are ${ITEMS.length} requests from users. Treat each as the only message of a new session. For each, name the ONE skill you would load first, or none if you would load no skill. Use the skill's short name (for example debug, not the plugin prefix).`,
			ITEMS.map((item, i) => `${i + 1}. ${item.request}`).join("\n"),
			"Answer with exactly one line per request, in the form `<number>: <skill or none>`, and nothing else.",
		].join("\n\n"),
	score: (text) => scoreAnswers(text),
	// the items, for tests and for reading a saved run
	items: ITEMS,
};
