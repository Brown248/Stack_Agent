// The bug from the A/B task bug-blank-name: the service no longer trims names, so "   " is stored with 201.
import { plant } from "../plant.mjs";

plant(process.cwd(), [["src/modules/items/service.js", 'input.name.trim() : ""', 'input.name : ""']], "items: take the name as sent");
