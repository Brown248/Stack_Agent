#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { askForProtected, protectedMentioned, protectedWhat } from "./protected-paths.mjs";
import { readHookInput } from "./read-input.mjs";

const WRITERS = /^(sed|perl|ruby|tee|mv|cp|rm|del|truncate|dd|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Clear-Content|sc|ac)$/i;

const SHELL_TOOLS = ["Bash", "PowerShell"];
const GIT_GLOBAL_WITH_VALUE = ["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"];
const HOOK_DISABLING_ENV = /^(HUSKY|HUSKY_SKIP_HOOKS|SKIP|PRE_COMMIT_ALLOW_NO_CONFIG|LEFTHOOK|SKIP_HOOKS)=/i;
const NESTED_SHELLS = /^(bash|sh|zsh|dash|pwsh|powershell|cmd)(\.exe)?$/i;

export function splitSegments(command) {
	const segments = [];
	let current = "";
	let quote = null;
	for (let i = 0; i < command.length; i++) {
		const c = command[i];
		if (quote) {
			if (c === "\\" && quote === '"') {
				current += c + (command[i + 1] ?? "");
				i++;
				continue;
			}
			if (c === quote) quote = null;
			current += c;
		} else if (c === '"' || c === "'") {
			quote = c;
			current += c;
		} else if (c === ";" || c === "\n" || c === "|" || c === "&") {
			segments.push(current);
			current = "";
			if ((c === "|" || c === "&") && command[i + 1] === c) i++;
		} else current += c;
	}
	segments.push(current);
	return segments.map((s) => s.trim()).filter(Boolean);
}

function tokenize(segment) {
	const tokens = [];
	for (const m of segment.matchAll(/"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g)) tokens.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]));
	return tokens;
}

function isGit(token) {
	return /^(.*[\\/])?git(\.exe)?$/i.test(token);
}

function parseGit(tokens) {
	const i = tokens.findIndex(isGit);
	if (i === -1) return null;
	const env = tokens.slice(0, i);
	const args = tokens.slice(i + 1);
	const globals = [];
	while (args.length && args[0].startsWith("-")) {
		const opt = args.shift();
		const name = opt.split("=")[0];
		if (GIT_GLOBAL_WITH_VALUE.includes(name) && !opt.includes("=")) globals.push(opt + "=" + (args.shift() ?? ""));
		else globals.push(opt);
	}
	const [sub, ...rest] = args;
	return { env, globals, sub, rest };
}

function shortFlags(rest) {
	return rest.filter((t) => /^-[a-zA-Z]+$/.test(t)).join("");
}

function classifyGit({ env, globals, sub, rest }) {
	if (globals.some((g) => /^-c=?core\.hookspath=/i.test(g)))
		return { decision: "deny", reason: "blocked: overriding core.hooksPath turns off the repo's git hooks and guard. Fix what the hook reports instead." };
	if ((sub === "commit" || sub === "push" || sub === "merge") && env.some((e) => HOOK_DISABLING_ENV.test(e)))
		return { decision: "deny", reason: `blocked: \`${env.join(" ")}\` turns off the repo's git hooks for this \`git ${sub}\`. Fix what the hook reports instead.` };
	if ((sub === "commit" || sub === "push" || sub === "merge" || sub === "am" || sub === "rebase") && rest.includes("--no-verify"))
		return { decision: "deny", reason: `blocked: \`git ${sub} --no-verify\` skips the repo's guard and checks. Fix what the hook reports instead.` };
	if (sub === "commit" && shortFlags(rest).includes("n"))
		return { decision: "deny", reason: "blocked: `git commit -n` is --no-verify and skips the repo's guard and checks. Fix what the hook reports instead." };
	if (sub === "push") {
		const forced = shortFlags(rest).includes("f") || rest.some((t) => t === "--force" || t.startsWith("--force-with-lease") || t.startsWith("--force-if-includes") || t === "--mirror" || /^\+/.test(t) || /^[^-][^:]*:\+/.test(t));
		if (forced) return { decision: "ask", reason: "force-push rewrites shared history and cannot be undone for others. A human must approve it." };
		const deletes = shortFlags(rest).includes("d") || rest.includes("--delete") || rest.includes("--prune") || rest.some((t) => /^:[^:]+$/.test(t));
		if (deletes) return { decision: "ask", reason: "this push deletes a remote branch or tag. A human must approve it." };
	}
	if (sub === "reset" && (rest.includes("--hard") || rest.includes("--merge") || rest.includes("--keep")))
		return { decision: "ask", reason: "`git reset --hard` discards uncommitted work permanently. A human must approve it." };
	if (sub === "clean" && (shortFlags(rest).includes("f") || rest.includes("--force")))
		return { decision: "ask", reason: "`git clean -f` deletes untracked files permanently. A human must approve it." };
	const onlyUnstages = sub === "restore" && (rest.includes("--staged") || rest.includes("-S")) && !rest.includes("--worktree") && !rest.includes("-W");
	if ((sub === "checkout" || sub === "restore") && !onlyUnstages && rest.some((t) => t === "." || t === ":/" || t === "*"))
		return { decision: "ask", reason: "this discards local changes to every file permanently. A human must approve it." };
	if (sub === "stash" && (rest[0] === "clear" || rest[0] === "drop"))
		return { decision: "ask", reason: "this deletes stashed work permanently. A human must approve it." };
	return null;
}

export function classify(command, depth = 0) {
	for (const segment of splitSegments(String(command ?? ""))) {
		const tokens = tokenize(segment);
		if (tokens.includes("--allow-increase"))
			return { decision: "ask", reason: "`--allow-increase` raises the guard baseline and accepts new rule violations. A human must approve it." };
		const redirected = tokens.flatMap((t, i) => {
			const glued = /^\d*>>?(.+)$/.exec(t);
			if (glued) return [glued[1]];
			return /^\d*>>?$/.test(t) && tokens[i + 1] ? [tokens[i + 1]] : [];
		});
		const redirectHit = redirected.find((t) => protectedWhat(t));
		if (redirectHit) return askForProtected(protectedWhat(redirectHit));
		const target = tokens.find((t) => protectedWhat(t));
		const inlineScript = tokens.some((t, i) => /^(node|python3?|deno|bun)(\.exe)?$/i.test(t) && /^-(e|c|p|-eval|-print)$/.test(tokens[i + 1] ?? ""));
		if (target && tokens.some((t) => WRITERS.test(t))) return askForProtected(protectedWhat(target));
		const scripted = inlineScript && tokens.map(protectedMentioned).find(Boolean);
		if (scripted) return askForProtected(scripted);
		const shellAt = tokens.findIndex((t) => NESTED_SHELLS.test(t));
		if (shellAt !== -1 && depth < 3) {
			const inner = tokens.slice(shellAt + 1).filter((t) => !/^-(c|Command|EncodedCommand|NoProfile|NonInteractive|lc|ic)$/i.test(t) && !/^\/c$/i.test(t)).join(" ");
			const nested = classify(inner, depth + 1);
			if (nested) return nested;
		}
		const git = parseGit(tokens);
		if (git) {
			const verdict = classifyGit(git);
			if (verdict) return verdict;
		}
	}
	return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const input = readHookInput();
	const verdict = SHELL_TOOLS.includes(input.tool_name) ? classify(input.tool_input?.command) : null;
	if (verdict) {
		process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } }));
	}
}
