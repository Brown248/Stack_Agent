// The same mistake twice, each time fixed in review: error bodies sent as { message } instead of { error }.
import { plant } from "../plant.mjs";

const dir = process.cwd();
const file = "src/modules/items/controller.js";
const good = "return res.json(400, { error: result.error });";
const bad = "return res.json(400, { message: result.error });";
plant(dir, [[file, good, bad]], "items: friendlier error body");
plant(dir, [[file, bad, good]], "fix: error bodies use { error }, per review");
plant(dir, [[file, good, bad]], "items: show the reason to the client");
plant(dir, [[file, bad, good]], "fix: error bodies use { error } again, per review");
