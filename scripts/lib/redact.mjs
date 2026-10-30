// Hides what should not travel from a past chat into a model's context or a file in the repo: keys, tokens, passwords,
// private keys, credentials inside a URL, card numbers, Thai national IDs, and email addresses. The rules follow
// tigerless-labs/autoharness (MIT, src/autoharness/lib/redaction_rules.toml) with a Thai password cue, the Thai ID
// checksum, and a review's findings added. Over-redacting is the safe side: a match is replaced whole by
// [REDACTED:<name>]. A shape no rule knows still gets through (an unquoted passphrase with spaces, a password typed after a prompt).
//
// Time: no rule may take longer than linear on its input. Three things keep it so: a run of characters has either a
// left boundary or a cap, a rule that needs a literal (`://`, `@`, `eyJ`) is skipped on text without it, and
// tests/redact.test.mjs feeds every rule megabytes of awkward text.

const luhn = (digits) => {
	let sum = 0;
	let double = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let d = digits.charCodeAt(i) - 48;
		if (double) {
			d *= 2;
			if (d > 9) d -= 9;
		}
		sum += d;
		double = !double;
	}
	return sum % 10 === 0;
};

// the 13th digit of a Thai national ID checks the first twelve (weights 13 down to 2, modulo 11)
const thaiId = (digits) => {
	if (digits.length !== 13) return false;
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += (digits.charCodeAt(i) - 48) * (13 - i);
	return (11 - (sum % 11)) % 10 === digits.charCodeAt(12) - 48;
};

// Visa (13 or 16), Mastercard (51-55, 2221-2720), Amex, Diners (300-305, 36, 38, 39), Discover (6011, 644-649, 65), JCB,
// UnionPay, Maestro (50, 56-69). A number must start like one of these and pass the checksum: the checksum alone passes
// one number in ten, so one millisecond timestamp in ten would go (those start with 17).
const CARD = /^(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|2(?:2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720)\d{12}|3[47]\d{13}|3(?:0[0-5]|[689]\d)\d{11}|35\d{14}|(?:50|5[6-9]|6\d)\d{11,14})$/;

const digitsOf = (s) => s.replace(/\D/g, "");

// A boundary before a key: not inside a longer word. In text copied from JSON a line break is the two characters
// `\n`, so the letter before a key can be that n; it counts as a boundary.
const BEFORE = String.raw`(?:(?<![A-Za-z0-9])|(?<=\\[nrt]))`;
const BEFORE_B64 = String.raw`(?:(?<![A-Za-z0-9_-])|(?<=\\[nrt]))`;
const QUOTE = String.raw`(?:\\?['"\x60])?`;
// a value may hold anything but white space, a quote, a backtick, a comma, a semicolon, an ampersand, a backslash, or
// Thai text (U+0E00-U+0E7F): a Thai sentence next to a key is not part of its value
const VALUE = String.raw`[^\s'"\x60,;&\\฀-๿]`;
// a password may hold those too, but not a quote, a backtick, a backslash, or Thai text
const PW_VALUE = String.raw`[^\s'"\x60\\฀-๿]`;
// what is read from somewhere else, not a secret written out: process.env.X, os.environ[...], ENV[...], getToken(req).
// Only a bare value is tested: a quoted one is a literal, whatever it looks like.
const READ_FROM_ELSEWHERE = /^(?:process\.env|import\.meta\.env|os\.environ|ENV[[.]|[A-Za-z_$][\w$.]*\([^)]*\)$)/;
// ...or a type, a schema word, or a path, which a person writes about code (`token: CancellationToken`,
// `password: required`, `PWD=/home/me`); a random key is none of these
const PASCAL_CASE = /^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/;
const GENERIC_TYPE = /^[A-Za-z_$][\w$.]*<[\w$.<>[\]]*>$/;
const SCHEMA_WORD = /^(?:required|optional|undefined|string|number|boolean|null|true|false|none|empty|hidden|masked|redacted)[.,;:)\]]*$/i;
// a path of plain words (/home/me/project); a secret that happens to start with / has digits or symbols in it
const PATH_LIKE = /^(?:~?\/|[A-Za-z]:[\\/])(?:[A-Za-z._-]+[\\/])*[A-Za-z._-]*$/;
const valueOf = (match) => match.replace(/^[^:：=]*(?:[:：=]|คือ)\s*(?:\\?['"\x60])?/, "");
const isQuoted = (match) => /^[^:：=]*(?:[:：=]|คือ)\s*\\?['"\x60]/.test(match);
// `pascal`: a PascalCase value is a type for a token or a secret (`token: CancellationToken`), but a password may be
// two words run together (`CorrectHorseBatteryStaple`), so the password rules do not take it
const notASecret = (match, { pascal = false } = {}) => {
	if (isQuoted(match)) return false;
	const v = valueOf(match);
	return READ_FROM_ELSEWHERE.test(v) || (pascal && PASCAL_CASE.test(v)) || GENERIC_TYPE.test(v) || SCHEMA_WORD.test(v) || PATH_LIKE.test(v);
};

// a value that is read from elsewhere or left as a blank to fill in: $PASS, ${PASS}, %PASS%, <password>, ****
const PLACEHOLDER = /^(?:[$%<{(]|\*+$)/;
// the words of one command between its name and a flag: not past a `;`, `&`, `|`, comma, or line break, each capped
const WORDS = String.raw`(?:[ \t]+[^\s;&|,]{1,100}){0,30}?`;

const rx = (source, flags = "g") => new RegExp(source, flags);

// Order matters: the first rule to match a stretch of text names it. A vendor key sits after the assignment rules on
// purpose, so `API_KEY=...` reports itself as an assignment and only a bare key is named for its vendor.
// `needs`: the rule runs only if the text holds one of these (lower case) strings.
export const RULES = [
	{ name: "private_key_block", needs: ["-----begin"], pattern: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g },
	// the next ones (down to the Stripe key) start with a prefix nobody types by accident, so they need no left boundary:
	// a key glued to letters is still a key. The OpenAI, Hugging Face, and SendGrid prefixes end ordinary words, so
	// those keep one.
	{ name: "aws_access_key_id", needs: ["akia", "asia"], pattern: /(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/g },
	{ name: "github_token", needs: ["ghp_", "gho_", "ghs_", "ghu_", "ghr_", "github_pat_"], pattern: /gh[posru]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{22,}/g },
	{ name: "gitlab_token", needs: ["glpat-"], pattern: /glpat-[A-Za-z0-9_-]{20,}/g },
	{ name: "slack_token", needs: ["xox"], pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/g },
	{ name: "slack_webhook", needs: ["hooks.slack.com"], pattern: /hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+/g },
	{ name: "bearer_token", needs: ["bearer"], pattern: /\bbearer\s+[A-Za-z0-9._-]{20,}/gi },
	{ name: "basic_auth_header", needs: ["basic"], pattern: /\bauthorization(?:\\?['"])?\s*[:=]\s*(?:\\?['"])?basic\s+[A-Za-z0-9+/=]{12,}/gi },
	// a secret read from elsewhere with a fallback written out: password: process.env.DB_PASS || "hunter2hunter2",
	// os.environ.get("API_TOKEN", "abc..."). The whole line from the key to the literal goes; the exemption for code
	// that reads from elsewhere must not let the literal through.
	{
		name: "secret_with_fallback",
		needs: ["key", "secret", "token", "pass", "pwd"],
		pattern: rx(String.raw`(?:api[_-]?key|secret(?:[_-]?access)?[_-]?key|secret|token|password|passwd|pwd|[_-]pass)${QUOTE}\s*[:=]\s*(?:[^\s,;'"\x60\\][^\s,;]{0,79}\s*(?:\|\||\?\?|\bor\b)|[\w$.]{0,40}(?:getenv|environ|env)[\w$.]{0,40}\([^\n),;]{0,60},)\s*(['"\x60])(?:(?!\1)[^\n]){6,200}\1`, "gi"),
	},
	// the key may be quoted ("api_key": ...) or have its quotes escaped (\"api_key\": ...); secret...key covers
	// secret_access_key and STRIPE_SECRET_KEY, and `secret` alone covers client_secret
	{
		name: "api_key_assignment",
		needs: ["key", "secret", "token"],
		pattern: rx(String.raw`(?:api[_-]?key|secret(?:[_-]?access)?[_-]?key|secret|token)${QUOTE}\s*[:=]\s*${QUOTE}${VALUE}{12,}`, "gi"),
		valid: (m) => !notASecret(m, { pascal: true }),
	},
	// a password is often shorter than a key; Thai users write the cue in Thai (รหัสผ่านคือ ..., รหัสผ่านของผมคือ ...).
	// A quoted value may hold spaces (a passphrase); a bare one is 8 or more characters, or 6 or 7 with a digit.
	{
		name: "password_assignment",
		needs: ["pass", "pwd", "รหัสผ่าน"],
		pattern: rx(
			String.raw`(?:password|passwd|pwd|[_-]pass|รหัสผ่าน[^\s:：=]{0,12}?)${QUOTE}\s*(?:[:：=]|คือ)\s*(?:(['"\x60])(?:(?!\1)[^\n]){6,200}\1|${QUOTE}(?:${PW_VALUE}{8,}|(?=${PW_VALUE}*\d)${PW_VALUE}{6,7}))`,
			"gi",
		),
		valid: (m) => !notASecret(m),
	},
	// "my password is Tr0ub4dor&3": only with a digit or a symbol in the value, so "the password is required" stays
	{
		name: "password_phrase",
		needs: ["password", "passwd"],
		pattern: rx(String.raw`(?:password|passwd)\s+is:?\s+[\x60'"]?(?=${PW_VALUE}*[0-9@#$%^&*+=~|<>{}\[\]()\\/])${PW_VALUE}{6,}`, "gi"),
	},
	// a password typed on a command line: mysql -pSecret, curl -u user:Secret, sshpass -p Secret, docker login -p Secret.
	// The command is part of the match (a lookbehind from the flag back to it would be tried at every character). Only
	// words of the same command lie between it and the flag: no `;`, `&`, `|`, comma, or line break, so `docker login
	// registry && mkdir -p src` and `install mysql, then tar -pczf` stay as they are, and every word is capped, so a long
	// line stays linear. A bare value that is read from elsewhere ($PASS, ${PASS}, %PASS%, <password>, ****) is not a
	// secret; a quoted one is a literal, whatever it looks like.
	{
		name: "command_line_password",
		needs: ["mysql", "mariadb", "curl", "sshpass", "login"],
		pattern: rx(
			[
				String.raw`\b(?:mysql|mysqldump|mysqladmin|mysqlimport|mysqlcheck|mariadb|mariadb-dump)\b${WORDS}[ \t]-p(?![ \t])[^\s;&|,]{3,100}`,
				String.raw`\bcurl\b${WORDS}[ \t](?:-[A-Za-z]{0,6}u|--user)(?:[ \t]+|=)?(?:['"][^\s:'"]{1,60}:[^'"\n]{3,100}['"]|[^\s:'"]{1,60}:(?:'[^'\n]{3,100}'|"[^"\n]{3,100}"|[^\s'"]{3,100}))`,
				String.raw`\bsshpass[ \t]+-p[ \t]*(?:'[^'\n]{3,100}'|"[^"\n]{3,100}"|[^\s'"]{3,100})`,
				String.raw`\b(?:docker|podman|helm)\b${WORDS}[ \t]login\b${WORDS}[ \t]-p[ \t]+(?:'[^'\n]{3,100}'|"[^"\n]{3,100}"|[^\s'"]{3,100})`,
			].join("|"),
			"g",
		),
		valid: (m) => {
			if (/['"]/.test(/[^\s:]+$/.exec(m)?.[0] ?? "")) return true; // a quoted value is a literal
			const tail = /[^\s:'"]+$/.exec(m)?.[0] ?? "";
			return !PLACEHOLDER.test(tail.startsWith("-p") ? tail.slice(2) : tail);
		},
	},
	// --password=VALUE and --password VALUE (also --passwd, --pass); --password-stdin and --password-file are other flags.
	// After a space the value needs a digit or a symbol, or quotes, so "do not pass --password with docker" stays; it
	// never holds Thai text or crosses a line.
	{
		name: "password_flag",
		needs: ["--pass"],
		pattern: rx(
			String.raw`(?<![\w-])--(?:password|passwd|pass)(?:=|[ \t]+)(?:(['"])(?:(?!\1)[^\n]){4,100}\1|(?=${PW_VALUE}*[0-9@#$%^&*+=~|<>{}\[\]()\\/])${PW_VALUE}{4,100})`,
			"gi",
		),
		valid: (m) => {
			const value = m.replace(/^--\w+(?:=|[ \t]+)/, "");
			return /^['"]/.test(value) || !PLACEHOLDER.test(value);
		},
	},
	{ name: "stripe_key", needs: ["k_live_", "k_test_"], pattern: /[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g },
	{ name: "anthropic_api_key", needs: ["sk-ant-"], pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g },
	// `sk-` ends many ordinary words (task-, risk-), so this one keeps its boundary
	{ name: "openai_api_key", needs: ["sk-"], pattern: rx(String.raw`${BEFORE}sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}`) },
	{ name: "google_api_key", needs: ["aiza"], pattern: /AIza[0-9A-Za-z_-]{35}/g },
	{ name: "npm_token", needs: ["npm_"], pattern: /npm_[A-Za-z0-9]{36}/g },
	{ name: "huggingface_token", needs: ["hf_"], pattern: rx(String.raw`${BEFORE}hf_[A-Za-z0-9]{30,}`) },
	{ name: "sendgrid_key", needs: ["sg."], pattern: rx(String.raw`${BEFORE}SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}`) },
	{ name: "azure_account_key", needs: ["accountkey="], pattern: /AccountKey=[A-Za-z0-9+/=]{20,}/g },
	// header and payload both start with eyJ, the base64 of `{"`. The boundary is what keeps this linear: without it
	// every `eyJ` inside one long base64 run starts a scan to the end of the run.
	{ name: "jwt", needs: ["eyj"], pattern: rx(String.raw`${BEFORE_B64}eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`) },
	// scheme://user:password@host, the user may be empty (redis://:password@host). The credential run reaches the last
	// @ that can start a host, so a password with a raw @ or / is removed whole. Every run is capped.
	{ name: "url_credentials", needs: ["://"], pattern: /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/@]{0,128}:[^\s]{1,256}@(?=[A-Za-z0-9._-]+(?::\d+)?(?:[/?#\s),.;}\]]|$))/gi },
	// 13 digits are a Thai ID with a dash or space between some of the groups 1-4-5-2-1 (1-2345-67890-12-3), or after a word that says so
	// (บัตร, เลขประจำตัว, national id): 13 plain digits alone are as likely a millisecond timestamp, and the check digit
	// passes one number in ten
	{ name: "thai_national_id", pattern: /(?<!\d)(?=\d*[- ]\d)\d[- ]?\d{4}[- ]?\d{5}[- ]?\d{2}[- ]?\d(?!\d)/g, valid: (m) => thaiId(digitsOf(m)) },
	{ name: "thai_national_id_cued", pattern: /(?<=(?:บัตร|เลขประจำตัว|national id|citizen id|id card)\D{0,12})\d{13}(?!\d)/gi, valid: (m) => thaiId(m) },
	// 13 to 16 digits, kept only when they start like a card and pass the checksum
	{ name: "credit_card", pattern: /(?<!\d)\d(?:[ -]?\d){12,15}(?!\d)/g, valid: (m) => CARD.test(digitsOf(m)) && luhn(digitsOf(m)) },
	// not `git@github.com:org/repo` (an ssh address: a colon and a path follow) and not `logo@2x.png` (a file name)
	{ name: "email", needs: ["@"], pattern: /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b(?!:[\w.~-]+\/)/g, valid: (m) => !/\.(?:png|jpe?g|gif|svg|webp|ico|css|js|ts|json)$/i.test(m) },
];

// { text, counts }: the text with each match replaced, and how many of each rule were hidden
export function redact(input) {
	let text = String(input ?? "");
	const counts = {};
	let lower = null;
	for (const rule of RULES) {
		if (rule.needs) {
			lower ??= text.toLowerCase();
			if (!rule.needs.some((n) => lower.includes(n))) continue;
		}
		const before = text;
		text = text.replace(rule.pattern, (match) => {
			if (rule.valid && !rule.valid(match)) return match;
			counts[rule.name] = (counts[rule.name] ?? 0) + 1;
			return `[REDACTED:${rule.name}]`;
		});
		if (text !== before) lower = null;
	}
	return { text, counts };
}

export const redactText = (input) => redact(input).text;

export const addCounts = (into, counts) => {
	for (const [k, n] of Object.entries(counts)) into[k] = (into[k] ?? 0) + n;
	return into;
};
