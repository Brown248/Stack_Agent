// A history for the review: the base commit from scaffold.mjs, then one commit that adds a length rule. Its spec and
// its error message say 50 characters, the code lets 500 through.
import fs from "node:fs";
import { plant } from "../plant.mjs";

fs.mkdirSync("specs", { recursive: true });
fs.writeFileSync("specs/name-limit.md", "# Name limit\n\nAn item name longer than 50 characters is refused with 400 and the error \"name must be at most 50 characters\".\n");
plant(process.cwd(), [["src/modules/items/service.js", 'if (!name) return { error: "name is required" };', 'if (!name) return { error: "name is required" };\n\tif (name.length > 500) return { error: "name must be at most 50 characters" };']], "items: refuse long names (specs/name-limit.md)");
