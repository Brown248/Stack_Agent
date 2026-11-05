#!/usr/bin/env node
// Human-in-the-loop reproduction loop. Copy this file, edit the part between the markers, and ask the person to run it
// in their own terminal: node hitl-loop.template.mjs
//
//   await step("<instruction>")           show the instruction, wait for Enter
//   const x = await capture("<question>") show the question, return the answer
//
// At the end the answers are printed as KEY=VALUE lines for the agent to read. `capture` shows the answer back, so
// capture observations and leave signing in or typing a password to the person as a `step`.
import readline from "node:readline";

// One line per answer, read as a stream, so it works typed at a terminal and piped from a file alike.
const lines = readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
const answers = {};

async function ask(prompt) {
	process.stdout.write(prompt);
	const { value, done } = await lines.next();
	return done ? "" : value;
}

async function step(instruction) {
	process.stdout.write(`
>>> ${instruction}
`);
	await ask("    [Enter when done] ");
}

async function capture(key, question) {
	process.stdout.write(`
>>> ${question}
`);
	answers[key] = (await ask("    > ")).trim();
}

// --- edit below ---------------------------------------------------------

await step("Open the app at http://localhost:3000 and sign in.");
await capture("ERRORED", "Click the 'Export' button. Did it throw an error? (y/n)");
await capture("ERROR_MSG", "Paste the error message (or 'none'):");

// --- edit above ---------------------------------------------------------

process.stdout.write("\n--- Captured ---\n");
for (const [key, value] of Object.entries(answers)) process.stdout.write(`${key}=${value}\n`);
