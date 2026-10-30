import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { RULES, redact, redactText } from "../scripts/lib/redact.mjs";
import { correctionsIn, main } from "../scripts/mine-transcripts.mjs";
import { repoRoot, tempDir, write } from "./helpers.mjs";

// Every fake secret is put together here, so no file in the repo holds a string a secret scanner would flag.
const join = (...p) => p.join("");
const pad = (c, n) => c.repeat(n);
const FAKE = {
	aws_access_key_id: join("AK", "IA", "ABCDEFGHIJKLMNOP"),
	github_token: join("gh", "p_", pad("a1B2", 9)),
	gitlab_token: join("gl", "pat-", pad("x", 24)),
	slack_token: join("xo", "xb-", "1234567890-", pad("a", 12)),
	slack_webhook: join("https://hooks.", "slack.com/services/", "T0AAAAAAA/B0BBBBBBB/", pad("c", 24)),
	bearer_token: join("Bearer ", pad("Ab1", 10)),
	basic_auth_header: join("Authorization: ", "Basic ", "YWRtaW46aHVudGVyMmh1bnRlcjI="),
	stripe_key: join("sk", "_live_", pad("Z9", 10)),
	anthropic_api_key: join("sk", "-ant-", pad("q", 30)),
	openai_api_key: join("sk", "-proj-", pad("Qw3", 15)),
	google_api_key: join("AI", "za", pad("a", 35)),
	npm_token: join("npm", "_", pad("b", 36)),
	huggingface_token: join("hf", "_", pad("Hh", 20)),
	sendgrid_key: join("SG", ".", pad("s", 22), ".", pad("t", 22)),
	azure_account_key: join("Account", "Key=", pad("Zm9v", 12), "=="),
	jwt: join("ey", "J", pad("a", 12), ".ey", "J", pad("b", 12), ".", pad("c", 12)),
	url_credentials: join("postgres://admin:", "hunter2hunter2", "@db.internal:5432/app"),
};
// the rules that report a bare key under its vendor's name (the others are named for the shape around the key)
const VENDOR = ["aws_access_key_id", "github_token", "gitlab_token", "slack_token", "slack_webhook", "stripe_key", "anthropic_api_key", "openai_api_key", "google_api_key", "npm_token", "huggingface_token", "sendgrid_key", "azure_account_key", "jwt"];

test("each kind of secret is replaced by its marker, and the text around it is kept", () => {
	for (const [name, secret] of Object.entries(FAKE)) {
		const { text, counts } = redact(`before ${secret} after`);
		// the host of a URL is not secret and stays; the password in front of it goes
		const probe = name === "url_credentials" ? "hunter2hunter2" : secret.slice(-12);
		assert.ok(!text.includes(probe), `${name} is still readable: ${text}`);
		assert.ok(text.startsWith("before ") && text.endsWith(" after"), name);
		assert.ok(Object.keys(counts).length >= 1, name);
	}
	for (const name of VENDOR) assert.deepEqual(redact(`x ${FAKE[name]} y`).counts, { [name]: 1 }, name);
	assert.deepEqual(redact(`curl -H "${FAKE.basic_auth_header}"`).counts, { basic_auth_header: 1 });
	assert.deepEqual(redact(`curl -H "Authorization: ${FAKE.bearer_token}"`).counts, { bearer_token: 1 });
	assert.deepEqual(redact(`DATABASE_URL=${FAKE.url_credentials}`).counts, { url_credentials: 1 });
	assert.equal(redactText("a" + join("AK", "IA") + "ABCDEFGHIJKLMNOP" + "!"), "a[REDACTED:aws_access_key_id]!");
	assert.deepEqual(redact(join("AS", "IA", "ABCDEFGHIJKLMNOP")).counts, { aws_access_key_id: 1 });
});

test("a key still shows up as a secret when it is glued to letters or sits in JSON-escaped text", () => {
	const gh = FAKE.github_token;
	const ant = FAKE.anthropic_api_key;
	const aws = FAKE.aws_access_key_id;
	for (const text of [`xxx${gh}`, `key${aws}`, `key${FAKE.stripe_key}`, `token:\\n${gh}`, `"output":"line1\\n${ant}"`, `"body":"\\n${aws}\\n"`, `{\\"api_key\\": \\"abcdefghijklmnop1234\\"}`, `{"api_key": "abcdefghijklmnop1234"}`, `line\\n${FAKE.jwt}`]) {
		assert.match(redactText(text), /\[REDACTED:/, text);
		assert.doesNotMatch(redactText(text), /ghp_a1B2|sk-ant-qq|AKIAABCD|abcdefghijklmnop1234|aaaaaaaaaaaa\./, text);
	}
	// an ordinary word that ends in sk- is not a key
	assert.equal(redactText("risk-assessment-for-the-new-dashboard-and-reporting-flow"), "risk-assessment-for-the-new-dashboard-and-reporting-flow");
});

test("a key written as an assignment, a password in English or Thai, and a private key are hidden", () => {
	const key = pad("k9", 8);
	for (const line of [`api_key = "${key}"`, `API_KEY: ${key}`, `"secret_key": "${key}"`, `STRIPE_SECRET_KEY=${key}`, `token=${key}`, `client_secret=Xy7!kP2@qR9#mN4$zz`]) {
		assert.deepEqual(redact(line).counts, { api_key_assignment: 1 }, line);
		assert.doesNotMatch(redact(line).text, /k9k9|Xy7|mN4|zz$/, line);
	}
	// the whole value goes, not up to its first symbol
	assert.equal(redactText("token=abcdefghijkl$mnopqrstuvwx ok"), "[REDACTED:api_key_assignment] ok");
	for (const line of ["password: Tr0ub4dor&3", "my password = 'hunter2hunter2'", "รหัสผ่านคือ Somchai2569", "รหัสผ่าน: Somchai2569", "รหัสผ่านของผมคือ Somchai2569", "password：Tr0ub4dor", "password: hunter2", 'password = "correct horse battery staple"', "DB_PASS=abcdefgh1234", "my password is Tr0ub4dor&3xyz"]) {
		assert.match(redactText(line), /\[REDACTED:password_/, line);
		assert.doesNotMatch(redactText(line), /Tr0ub4dor|hunter2|Somchai|correct horse|abcdefgh1234/, line);
	}
	const pem = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEpAIBAAKCAQEA\nabc+/=", "-----END RSA PRIVATE KEY-----"].join("\n");
	assert.equal(redactText(`here:\n${pem}\nthanks`), "here:\n[REDACTED:private_key_block]\nthanks");
	// a key cut off before its END line is hidden to the end of the text
	assert.equal(redactText("start -----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhki"), "start [REDACTED:private_key_block]");
});

test("a correction about passwords or keys is not eaten: Thai text and code that reads a secret from elsewhere stay", () => {
	for (const text of [
		"ไม่ใช่ รหัสผ่านคือสิ่งที่ห้ามเก็บใน log เด็ดขาด",
		"ห้าม log password: ทุกกรณีเลยนะครับ",
		"รหัสผ่าน: ต้องเข้ารหัสด้วยbcryptเสมอ",
		"the password is required",
		"password rules: at least eight characters",
		"password = getPasswordFromVault(name)",
		"password: process.env.DB_PASSWORD",
		"secret: process.env.SESSION_SECRET",
		"csrf_token = generateCsrfToken()",
		"token = os.environ['API_TOKEN']",
		"the token expires after 30 minutes",
	]) assert.equal(redactText(text), text);
});

test("a URL with an empty user (redis://:password@host) is hidden", () => {
	assert.equal(redactText("redis://:s3cretpass@cache:6379/0"), "[REDACTED:url_credentials]cache:6379/0");
	assert.equal(redactText("https://example.com/a and https://example.com:8080/b"), "https://example.com/a and https://example.com:8080/b");
});

test("a card number is hidden only when it starts like one and its checksum holds, so a timestamp stays", () => {
	assert.equal(redactText("card 4111 1111 1111 1111 ok"), "card [REDACTED:credit_card] ok");
	assert.equal(redactText("card 4111-1111-1111-1111."), "card [REDACTED:credit_card].");
	assert.equal(redactText("amex 378282246310005"), "amex [REDACTED:credit_card]");
	assert.equal(redactText("order 4111111111111112 and ports 3000 3001 3002 3003"), "order 4111111111111112 and ports 3000 3001 3002 3003");
	// 13-digit millisecond timestamps never start like a card, whatever the checksum says
	let hidden = 0;
	for (let n = 1730000000000; n < 1730000000000 + 5000 * 7919; n += 7919) if (redactText(String(n)) !== String(n)) hidden++;
	assert.equal(hidden, 0);
});

test("a Thai national ID is hidden with its separators or after a word that says what it is, and never as a bare number", () => {
	const twelve = "110170020345";
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (13 - i);
	const id = twelve + ((11 - (sum % 11)) % 10);
	const dashed = `${id[0]}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10, 12)}-${id[12]}`;
	assert.equal(redactText(`เลขบัตร ${id} ครับ`), "เลขบัตร [REDACTED:thai_national_id_cued] ครับ");
	assert.equal(redactText(`บัตรประชาชน: ${id}`), "บัตรประชาชน: [REDACTED:thai_national_id_cued]");
	assert.equal(redactText(`my national id is ${id}`), "my national id is [REDACTED:thai_national_id_cued]");
	assert.equal(redactText(dashed), "[REDACTED:thai_national_id]");
	assert.equal(redactText(`created_at ${id}`), `created_at ${id}`, "13 plain digits are as likely a timestamp");
	const wrong = twelve + String((Number(id[12]) + 1) % 10);
	assert.equal(redactText(`เลขบัตร ${wrong}`), `เลขบัตร ${wrong}`, "the check digit must hold");
});

test("an email is hidden, but not an ssh address or a file name", () => {
	assert.equal(redactText("mail somchai.j+x@example.co.th now"), "mail [REDACTED:email] now");
	assert.equal(redactText("git@github.com:org/repo.git and logo@2x.png"), "git@github.com:org/repo.git and logo@2x.png");
	assert.equal(redactText("git@company.com and ivan@company.md"), "[REDACTED:email] and [REDACTED:email]");
});

test("the other card networks, a Thai ID with some separators, and a quoted password that looks like code are hidden", () => {
	for (const card of ["3056 9309 0259 04", "36227206271667", "6445644564456445", "6759649826438453", "5555555555554444", "6011111111111117"]) assert.equal(redactText(`card ${card}`), "card [REDACTED:credit_card]", card);
	assert.equal(redactText("1-1017-00203-450"), "[REDACTED:thai_national_id]");
	assert.equal(redactText("บัตร ปชช. 1101700203450"), "บัตร ปชช. [REDACTED:thai_national_id_cued]");
	assert.equal(redactText("ID card 11017-00203-45-0"), "ID card [REDACTED:thai_national_id]");
	for (const line of ['password = "Summer(2024)!"', "password: Summer(2024)!", '"api_key": "Ab3dE(f9GhIjKlMn"', "token=ENV-9f8e7d6c5b4a3f2e", "password: pässwörd123", "my password is `Tr0ub4dor&3`", "the password is: Tr0ub4dor&3"]) {
		assert.notEqual(redactText(line), line, line);
		assert.doesNotMatch(redactText(line), /Summer|Ab3dE|9f8e7d|wörd123|Tr0ub4dor/, line);
	}
	// code that reads the secret from elsewhere is still left alone
	for (const line of ["password = getPasswordFromVault(name)", "token = ENV['API_TOKEN']", "secret: process.env.SESSION_SECRET"]) assert.equal(redactText(line), line);
});

test("a quoted password is hidden up to 200 characters and with another quote inside, and a hard-coded fallback is hidden with it", () => {
	for (const line of [
		`password = "${"correct horse battery staple ".repeat(5).trim()}"`,
		`password = "don't tell anyone 99"`,
		`password: process.env.DB_PASS || "Tr0ub4dor&3xyz"`,
		`const password = process.env.DB_PASS ?? "Tr0ub4dor&3xyz";`,
		`token = os.environ.get("API_TOKEN", "abcdefghijklmnop1234")`,
		`api_key: config.get('key') or 'abcdefghijklmnop1234'`,
	]) {
		assert.match(redactText(line), /\[REDACTED:/, line);
		assert.doesNotMatch(redactText(line), /correct horse|tell anyone|Tr0ub4dor|abcdefghijklmnop1234/, line);
	}
	// a JSON object with a password and some other quoted text is not a fallback
	assert.equal(redactText('{"name": "bob smith", "note": "something long here"}'), '{"name": "bob smith", "note": "something long here"}');
	// the keys whose prefix ends ordinary words are found after a JSON-escaped line break, a Thai word glued to a value
	// does not hide the word, and a cue spaced from its Thai "is" still finds the password
	for (const key of [FAKE.openai_api_key, FAKE.huggingface_token, FAKE.sendgrid_key]) assert.match(redactText(`text\\n${key}\\nmore`), /\[REDACTED:/, key);
	assert.equal(redactText("token: abcdefghijkl123ไม่ถูกต้อง"), "[REDACTED:api_key_assignment]ไม่ถูกต้อง");
	assert.match(redactText("รหัสผ่านของผม คือ Tr0ub4dor&3"), /\[REDACTED:password_/);
	assert.equal(redactText("รหัสผ่าน คือ Tr0ub4dor&3"), "[REDACTED:password_assignment]");
	assert.equal(redactText("my password is: Tr0ub4dor&3"), "my [REDACTED:password_phrase]");
});

test("what a person writes about code is not taken for a secret: types, schema words, paths, sentences, digits", () => {
	for (const text of [
		"the password is required.",
		"No, the password is wrong, try again",
		"password: required",
		"password: undefined",
		"token: CancellationToken",
		"token: Promise<string>",
		"secret: SecretManagerServiceClient",
		"PWD=/home/user/project",
		"cd to pwd: C:\\Users\\me\\project",
		"steps 1 2 3 4 5 6 7 8 9 10 11 12",
	]) assert.equal(redactText(text), text);
});

test("a fallback is hidden for every name a secret goes by, and only where the left side is code that reads the secret", () => {
	for (const [line, leak] of [
		['SECRET_KEY = os.environ.get("SECRET_KEY", "django-insecure-9f8e7d6c5b4a3f2e")', "django-insecure"],
		['STRIPE_SECRET_KEY: process.env.STRIPE_KEY || "whsec_9f8e7d6c5b4a3f2e"', "whsec_"],
		['aws_secret_access_key = os.getenv("AWS_SECRET") or "wJalrXUtnFEMIK7MDENGbPxRfiCY"', "wJalr"],
		['secret_key: settings.SECRET_KEY or "change-me-in-production"', "change-me"],
	]) {
		assert.match(redactText(line), /\[REDACTED:secret_with_fallback\]/, line);
		assert.ok(!redactText(line).includes(leak), line);
	}
	// a call whose later argument is a string, and an "or" in a sentence, are not a fallback
	for (const text of ['secret: hmac(key, "sha256")', "token: one of 'access', 'refresh'", 'No, the token = the old one or "a fresh one from the API"', '"token": null, "message": "Login failed for this user"']) assert.equal(redactText(text), text);
	// the rule starts after the value, never at a quote: a JSON object keeps the text after a password
	const json = redactText('{"password": "abcdefgh", "description": "the user login secret"}');
	assert.ok(json.includes('"description": "the user login secret"') && !json.includes("abcdefgh"), json);
});

test("what looks like code is left alone only where a real secret would not look like it", () => {
	// a password can be two words run together, or a path, or a word like true with a mark after it
	for (const line of ["password: CorrectHorseBatteryStaple", "DB_PASSWORD=SummerVacation", "password: /Tr0ub4dor&3", "password: C:/Tr0ub4dor&3x", "password: true!!!!!!"]) {
		assert.notEqual(redactText(line), line, line);
		assert.doesNotMatch(redactText(line), /CorrectHorse|SummerVacation|Tr0ub4dor|true!!/, line);
	}
	// a base64 secret can start with a slash, and a quoted literal is a literal whatever it looks like
	assert.doesNotMatch(redactText("AWS_SECRET_ACCESS_KEY=/k3Jx9QmZt8Wv2Lr5Np7Ys1Bd4Hf6Gc0Ea+RuTo"), /k3Jx9/);
	assert.doesNotMatch(redactText('api_key: "process.env.whatever_value"'), /whatever_value/);
	assert.doesNotMatch(redactText('api_key: "CancellationToken"'), /CancellationToken/);
	// a type for a token, a path of words, a schema word with its full stop
	for (const text of ["token: CancellationToken", "secret: SecretManagerServiceClient", "PWD=/home/user/project", "cd ~/work/my-project; password: required."]) assert.equal(redactText(text), text);
});

test("ordinary text, code, and numbers are left as they were", () => {
	for (const text of [
		"No, SQL goes in repository.js, every time.",
		"ห้ามแก้ migration ที่ใช้ไปแล้ว",
		"git commit abc1234 and 0123456789",
		"see https://example.com/docs and user@localhost",
		"risk-assessment task-manager disk-usage",
		"eyJ is how base64 of a json brace starts",
	]) assert.equal(redactText(text), text);
});

test("every rule has a case above: a rule added without one fails here", () => {
	const covered = new Set([...Object.keys(FAKE), "api_key_assignment", "secret_with_fallback", "password_assignment", "password_phrase", "command_line_password", "password_flag", "private_key_block", "credit_card", "thai_national_id", "thai_national_id_cued", "email"]);
	for (const rule of RULES) assert.ok(covered.has(rule.name), `${rule.name} has no test`);
	assert.equal(new Set(RULES.map((r) => r.name)).size, RULES.length, "two rules share a name");
});

test("redacting twice changes nothing more, and nothing in a marker looks like a secret to another rule", () => {
	const all = Object.values(FAKE).join("\n") + "\npassword: Tr0ub4dor&3\ncard 4111 1111 1111 1111\nme@example.com";
	const once = redactText(all);
	assert.equal(redactText(once), once);
	for (const rule of RULES) assert.equal(redactText(`[REDACTED:${rule.name}]`), `[REDACTED:${rule.name}]`, rule.name);
	assert.equal(redactText(null), "");
});

// Time grows with the length of the text, not its square. The text goes through every rule in a child process (see
// the fixture) with a timeout, so a quadratic rule fails here instead of hanging the runner: without its boundary the
// jwt rule ran past four minutes at one megabyte, and without their caps the email and URL rules took minutes.
// The limits are generous for a slow CI runner; a rule that is quadratic misses them by orders of magnitude.
test("a megabyte of awkward text goes through every rule in well under a few seconds", () => {
	const r = spawnSync(process.execPath, [path.join(repoRoot, "tests", "fixtures", "redact-perf.mjs")], { encoding: "utf8", timeout: 90_000 });
	assert.equal(r.error?.code, undefined, `the run did not finish in time: ${r.error?.message}`);
	assert.equal(r.status, 0, r.stderr);
	const ms = JSON.parse(r.stdout);
	assert.ok(Object.keys(ms).length >= 21, "every kind of text ran");
	for (const [label, took] of Object.entries(ms)) assert.ok(took < 5000, `${label} took ${took} ms`);
});

const line = (o) => JSON.stringify(o);
const user = (text) => line({ type: "user", sessionId: "s1", timestamp: "2026-10-20T10:00:00Z", message: { role: "user", content: [{ type: "text", text }] } });
const agent = (text) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });

test("mining hides a secret in a message and in the reply before it, even one the length cut would have split", () => {
	const gh = FAKE.github_token;
	// the key sits across the 600-character cut of the message and the 300-character cut of the reply
	const said = `No, stop. ${"x".repeat(580)} use ${gh} instead`;
	const reply = `${"y".repeat(9)} ${gh} ${"y".repeat(280)}`;
	assert.ok(reply.slice(-300).includes("a1B2a1B2"), "the fixture must leave part of the key after the cut");
	const counts = {};
	const [f, g] = correctionsIn([user("start"), agent("ok"), user(said), agent(reply), user("no, wrong again")].join("\n"), { all: true, counts });
	assert.ok(said.slice(0, 600).includes("ghp_"), "the fixture must put the start of the key before the cut");
	assert.ok(!f.text.includes("ghp_") && !f.text.includes("a1B2"), f.text);
	assert.ok(!g.after.includes("a1B2"), g.after);
	assert.equal(counts.github_token, 2);
});

test("the command says how many it hid, in the summary and in the JSON, and none of it reaches the output", () => {
	const dir = tempDir("stack-agent-redact-");
	const stripe = FAKE.stripe_key;
	write(dir, "a.jsonl", [user("start"), agent("done"), user(`No, use ${stripe} and mail me at me@example.com`)].join("\n"));
	const text = main(["--transcripts", dir]).text;
	assert.match(text, /^1 message\(s\) after an agent reply/);
	assert.match(text, /2 secret\(s\) or personal detail\(s\) were replaced by \[REDACTED:\.\.\.\] \(stripe_key 1, email 1\)/);
	assert.ok(!text.includes(stripe) && !text.includes("me@example.com"));
	const json = main(["--transcripts", dir, "--json"]).text;
	assert.deepEqual(JSON.parse(json).redacted, { stripe_key: 1, email: 1 });
	assert.ok(!json.includes(stripe));
	const clean = tempDir("stack-agent-redact-");
	write(clean, "b.jsonl", [user("start"), agent("done"), user("No, wrong file")].join("\n"));
	assert.doesNotMatch(main(["--transcripts", clean]).text, /replaced by/);
});

test("a password typed on a command line is hidden, and a flag that only looks like one is not", () => {
	const hidden = [
		["mysql -u root -pHunter2Hunter2 mydb", "Hunter2Hunter2"],
		["mysqldump --single-transaction -u app -pS3cretPass db > dump.sql", "S3cretPass"],
		["curl -u admin:S3cretPass https://x.example.com/api", "S3cretPass"],
		["curl --user=admin:S3cretPass https://x.example.com", "S3cretPass"],
		["sshpass -p 'S3cretPass' ssh me@host", "S3cretPass"],
		["docker login -u me -p S3cretPass registry.example.com", "S3cretPass"],
		["tool --password S3cretPass --verbose", "S3cretPass"],
		["tool --passwd=S3cretPass x", "S3cretPass"],
		['tool --password "two words here" x', "two words"],
	];
	for (const [input, secret] of hidden) {
		const { text, counts } = redact(input);
		assert.ok(!text.includes(secret), `still readable: ${text}`);
		assert.ok(Object.keys(counts).length > 0, input);
	}
	const kept = [
		"mysql -u root -p mydb", // -p alone asks for the password at a prompt
		"mkdir -p src/lib && ls -p",
		"curl -u admin https://x.example.com",
		"curl -u admin:$PASS https://x.example.com",
		"curl -sS https://example.com -o out.txt",
		"sshpass -p $PW ssh me@host",
		"echo $PW | docker login --password-stdin",
		"tool --password-stdin --password-file f",
		"tool --password $DB_PASS",
		"tool --password ${DB_PASS}",
		"tool --pass-through x",
	];
	for (const input of kept) assert.equal(redactText(input), input);
	// the host and the flags around it stay, so what was run can still be read
	assert.match(redactText("mysql -u root -pHunter2Hunter2 mydb"), /mydb$/);
});

test("a command-line password rule stays inside one command, one line, and ordinary prose (found by a review)", () => {
	const kept = [
		"Don't pass --password with docker",
		"the --password option is deprecated",
		"ใช้ --password ตามด้วยรหัส",
		"tool --password\nThen run tests",
		"docker login registry.example.com && mkdir -p src/lib",
		"docker login ghcr.io; ssh -p 2222 me@host",
		"mysqldump db > d.sql && rsync -prtv a b",
		"install mysql, then tar -pczf x.tgz y",
		"docker login -u me -p\nnpm install",
		"sshpass -p\nls",
	];
	for (const input of kept) assert.equal(redactText(input), input);
	// more ways to write the same command, and a quoted value is a literal even when it starts like a variable
	const hidden = [
		["curl -uadmin:S3cretPass https://x.example.com", "S3cretPass"],
		["curl -su admin:S3cretPass https://x.example.com", "S3cretPass"],
		["curl -u admin:'S3cret Pass' https://x.example.com", "S3cret Pass"],
		["curl -u 'admin:S3cret Pass' https://x.example.com", "S3cret Pass"],
		["sshpass -p '$Pa55w0rd' ssh me@host", "Pa55w0rd"],
		["tool --password '$Pa55w0rd' x", "Pa55w0rd"],
		["tool --password '(S3cret!)' x", "S3cret!"],
		["mysql -p'S3cret Pass' db", "S3cret Pass"],
	];
	for (const [input, secret] of hidden) assert.ok(!redactText(input).includes(secret), `still readable: ${redactText(input)}`);
});
