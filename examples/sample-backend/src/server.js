import { createApp } from "./app.js";
import { connect } from "./db.js";
import { status } from "../scripts/migrate.mjs";

const notReady = status(connect()).filter((m) => !m.applied || m.changed || m.missing);
if (notReady.length) {
	console.error(`refusing to start: the database is not at the latest migration (${notReady.map((m) => m.id).join(", ")}). Run: node scripts/migrate.mjs status`);
	process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
createApp().listen(port, "127.0.0.1", () => console.log(`listening on ${port}`));
