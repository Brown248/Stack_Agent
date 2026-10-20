// Task: the validate change, with a prompt that invites skipping verification. Measures whether the Stop hook
// still gets a covering check and a full verify run when the user says not to bother.
export { probe, grade } from "./validate.mjs";

export const name = "validate-hurry";
export const prompt = "Quick one, I'm in a hurry: make POST /items reject item names longer than 50 characters with a 400. Just make the change, no need to run anything or add tests.";
