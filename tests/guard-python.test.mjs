import assert from "node:assert/strict";
import { test } from "node:test";
import { main } from "../scripts/guard.mjs";
import { tempDir, write } from "./helpers.mjs";

const guard = (dir, ...args) => main(["--root", dir, ...args]);
const lines = (dir, rule) =>
	JSON.parse(guard(dir, "--json").text)
		.violations.filter((v) => v.rule === rule)
		.map((v) => `${v.file}:${v.line}`);

function pyRepo({ pkg = "app", config = {} } = {}) {
	const dir = tempDir("stack-agent-py-");
	const base = pkg === "app" ? "" : "src/";
	for (const f of ["app/__init__.py", "app/db.py", "app/api/__init__.py", "app/modules/__init__.py", "app/modules/items/__init__.py", "app/modules/items/repo.py", "app/modules/orders/__init__.py"])
		write(dir, base + f, "");
	write(
		dir,
		".stack-agent/guard.config.json",
		JSON.stringify({
			...config,
			rules: [
				{ id: "api-no-db", type: "forbidden-import", files: [`${base}app/api/**`], to: [`${base}app/db.py`], message: "views must not touch the db", fix: "call a service" },
				{ id: "no-requests", type: "forbidden-import", files: ["**/*.py"], toSpecifiers: ["requests"], message: "no raw http", fix: "use app.http" },
				{ id: "modules", type: "module-boundary", modulesRoot: `${base}app/modules`, message: "cross-module internals", fix: "import the package" },
			],
		}),
	);
	return dir;
}

test("python: every import form is flagged on the line of its module", () => {
	const dir = pyRepo();
	write(
		dir,
		"app/api/views.py",
		[
			"import app.db",
			"import os, app.db as database",
			"from app.db import connect",
			"from app import db",
			"from .. import db",
			"from ..db import connect",
			"from app.db import (",
			"    connect,",
			"    close,",
			")",
			"from app import (os_path,",
			"    db as d)",
			"if True: import app.db",
			"import json; import app.db",
			"from app.api import helpers",
			"",
		].join("\n"),
	);
	assert.deepEqual(lines(dir, "api-no-db"), [1, 2, 3, 4, 5, 6, 7, 12, 13, 14].map((n) => `app/api/views.py:${n}`));
});

test("python: imports inside comments and strings are ignored", () => {
	const dir = pyRepo();
	write(
		dir,
		"app/api/views.py",
		[
			"# import app.db",
			'"""Example:',
			"",
			"    from app import db",
			'"""',
			"x = 'import app.db'",
			'y = "from ..db import connect"  # from app.db import x',
			"z = r'\\'' ; s = '''",
			"import app.db'''",
			"raise ValueError('x') from None",
			"",
		].join("\n"),
	);
	assert.equal(guard(dir).code, 0, guard(dir).text);
	write(dir, "app/api/views.py", 'DOC = """import app.db"""\n\n\nfrom app import db\n');
	assert.deepEqual(lines(dir, "api-no-db"), ["app/api/views.py:4"]);
});

test("python: relative imports resolve against the importing package", () => {
	const dir = pyRepo();
	write(dir, "app/api/views.py", "from . import helpers\nfrom .helpers import x\n");
	write(dir, "app/api/helpers.py", "from ..db import connect\n");
	assert.deepEqual(lines(dir, "api-no-db"), ["app/api/helpers.py:1"]);
	write(dir, "app/api/sub/__init__.py", "from ... import db\n");
	assert.deepEqual(lines(dir, "api-no-db"), ["app/api/helpers.py:1", "app/api/sub/__init__.py:1"]);
});

test("python: third-party toSpecifiers match the package and its submodules", () => {
	const dir = pyRepo();
	write(dir, "app/api/views.py", "import requests\nimport requests.adapters as a\nfrom requests import get\nfrom requests.sessions import Session\nimport requestsx\nfrom . import requests\n");
	assert.deepEqual(lines(dir, "no-requests"), [1, 2, 3, 4].map((n) => `app/api/views.py:${n}`));
});

test("python: module-boundary allows the package __init__ and flags internals", () => {
	const dir = pyRepo();
	write(dir, "app/modules/orders/service.py", "from app.modules.items import get_items\nfrom app.modules import items\nfrom ..items import get_items\nfrom . import service\n");
	assert.equal(guard(dir).code, 0, guard(dir).text);
	write(dir, "app/modules/orders/service.py", "from app.modules.items.repo import insert\nfrom ..items import repo\nimport app.modules.items.repo\nfrom app.modules.items import (\n    get_items,\n    repo,\n)\n");
	assert.deepEqual(lines(dir, "modules"), [1, 2, 3, 6].map((n) => `app/modules/orders/service.py:${n}`));
});

test("python: a src/ layout resolves by default, and pythonRoots overrides the search", () => {
	const dir = pyRepo({ pkg: "src" });
	write(dir, "src/app/api/views.py", "import app.db\n");
	assert.deepEqual(lines(dir, "api-no-db"), ["src/app/api/views.py:1"]);
	const other = pyRepo({ pkg: "src", config: { pythonRoots: ["lib"] } });
	write(other, "src/app/api/views.py", "import app.db\n");
	assert.equal(guard(other).code, 0, "with pythonRoots [lib] the src package is not found, so app.db is third-party");
});

test("python: pythonRoots must be an array of strings", () => {
	const dir = pyRepo({ config: { pythonRoots: "src" } });
	assert.throws(() => guard(dir), /pythonRoots must be an array of strings/);
});
