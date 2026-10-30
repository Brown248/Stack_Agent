// Run by tests/redact.test.mjs in its own process, so a rule that is quadratic fails the test at its timeout instead of
// hanging the test runner (a regex cannot be interrupted from inside the process that runs it).
// Prints the milliseconds redact() took on each kind of awkward text of a megabyte.
import { redact } from "../../scripts/lib/redact.mjs";

const N = 1_000_000;
const rep = (s) => s.repeat(Math.ceil(N / s.length)).slice(0, N);
const base64json = Buffer.from(JSON.stringify(Array.from({ length: N / 20 }, (_, i) => ({ id: i, ok: true })))).toString("base64url").slice(0, N);

const awkward = {
	a: "a".repeat(N),
	// a long run before the literal a rule waits for: each start position would scan the whole run
	"a...@": "a".repeat(N) + "@",
	"a-...://": "a-".repeat(N / 2) + "://",
	eyJ: rep("eyJ"),
	base64json,
	"a@": rep("a@"),
	"1-": rep("1-"),
	digits: "1".repeat(N),
	pem: `-----BEGIN PRIVATE KEY-----${"x".repeat(N)}`,
	"key=": rep("key="),
	"token=a,'": rep("token=a,'"),
	"password: ": rep("password: "),
	"password is ": rep("password is "),
	"token: a || ": rep("token: a || "),
	"x = getenv(\"K\", ": rep("x = getenv(\"K\", \""),
	"password = \"": rep('password = "a '),
	"http://": rep("http://"),
	"x://:": rep("x://:"),
	"sk-": rep("sk-"),
	ghp_: rep("ghp_"),
	"\\n": rep("\\n"),
	รหัสผ่าน: rep("รหัสผ่าน"),
	"mysql -p": rep("mysql -p"),
	"mysql ... -p": "mysql " + "a ".repeat(N / 2),
	"curl -u a:": rep("curl -u a:"),
	"curl ...": "curl " + "a ".repeat(N / 2),
	"sshpass -p": rep("sshpass -p "),
	"docker login -p": rep("docker login -p "),
	"--password ": rep("--password "),
	"mysql + one long word": "mysql " + "a".repeat(N),
	"docker login ...": "docker login " + "x ".repeat(N / 2),
	"curl -u + long user": "curl -u " + "u".repeat(N),
	"mysql mysql ...": rep("mysql "),
	"--password 1 ...": rep("--password 1"),
};

const out = {};
for (const [label, text] of Object.entries(awkward)) {
	const t = performance.now();
	redact(text);
	out[label] = Math.round(performance.now() - t);
}
console.log(JSON.stringify(out));
