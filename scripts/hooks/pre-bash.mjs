#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORKFLOWS_FOLDER, askForProtected, protectedMentioned, protectedWhat, workflowsFolderMentioned } from "./protected-paths.mjs";
import { projectContext } from "./project-context.mjs";
import { findUp, readHookInput } from "./read-input.mjs";

const WRITERS = /^(sed|perl|ruby|tee|mv|cp|rm|del|erase|unlink|rmdir|rd|ri|find|shred|truncate|dd|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Clear-Content|sc|ac)$/i;
// the hooks' session records and their notes: a command that names them (globs included) and deletes, moves, or
// writes asks, whatever program does it; reading them stays free. A soft barrier, like the evidence files.
const SESSIONS_MENTION = /\.stack-agent[\\/]+evid[^\s'"]*[\\/]+sess|stack-agent-sessions/i;
const CHANGES_FILES = /(^|[\s;&|(])(rm|del|erase|unlink|rmdir|rd|ri|shred|truncate|mv|move|ren|rename|tee|Remove-Item|Move-Item|Rename-Item|Set-Content|Out-File|Clear-Content)(\.exe)?(\s|$)|-delete\b|-exec\b|>|\b(node|python3?|deno|bun|perl|ruby)(\.exe)?\s+-[ecp]\b/i;

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
	// -d alone refuses to delete a branch whose commits are not merged anywhere; -D or --delete --force deletes them
	// git accepts any unambiguous prefix of a long option: --del for --delete, --forc for --force
	const long = (name, min) => rest.some((t) => t.length >= min && name.startsWith(t));
	if (sub === "branch" && (shortFlags(rest).includes("D") || ((shortFlags(rest).includes("d") || long("--delete", 5)) && (shortFlags(rest).includes("f") || long("--force", 6)))))
		return { decision: "ask", reason: "`git branch -D` deletes a branch even when its commits are not merged anywhere, which can lose work. A human must approve it." };
	// these point an existing branch somewhere else; its old commits survive only in the reflog. -M (force rename)
	// is left alone: `git branch -M main` is the usual first step of a new repository.
	const branchFlags = shortFlags(rest.filter((t, i) => !/^--(sort|format|contains|no-contains|merged|no-merged|points-at|set-upstream-to)$/.test(rest[i - 1] ?? "")));
	const forceMoves =
		(sub === "branch" && (/[fC]/.test(branchFlags) || long("--force", 6))) ||
		(sub === "checkout" && shortFlags(rest).includes("B")) ||
		(sub === "switch" && (shortFlags(rest).includes("C") || long("--force-create", 9)));
	if (forceMoves)
		return { decision: "ask", reason: `\`git ${sub}\` with a force flag points an existing branch at other commits; its old commits are then reachable only through the reflog. A human must approve it.` };
	if (sub === "stash" && (rest[0] === "clear" || rest[0] === "drop"))
		return { decision: "ask", reason: "this deletes stashed work permanently. A human must approve it." };
	return null;
}

// An interpreter given its program as an argument: node -e / -pe / --eval=..., python -c / -Ic / -X utf8 -c,
// py -3 -c, deno eval. Only the interpreter's own options are read, up to the first argument that is not one, so
// a script's flags (node build.js -c x) are not mistaken for it.
const INTERPRETER = /^(.*[\\/])?(node|nodejs|python[\d.]*w?|pythonw|py|deno|bun)(\.exe)?$/i;
const OPTION_WITH_VALUE = /^(-X|-W|-r|--require|--import|--loader|--input-type|--env-file|-Q)$/;
function hasInlineScript(tokens) {
	return tokens.some((t, i) => {
		if (!INTERPRETER.test(t)) return false;
		for (let j = i + 1; j < tokens.length && j < i + 10; j++) {
			const f = tokens[j];
			if (/^-[A-Za-z]*[ecp]$/.test(f) || /^--(eval|print)(=|$)/.test(f)) return true;
			if (j === i + 1 && f === "eval") return true;
			if (OPTION_WITH_VALUE.test(f)) j++;
			else if (!f.startsWith("-")) return false;
		}
		return false;
	});
}
const DELETERS = /^(rm|rmdir|rd|del|erase|Remove-Item|ri)(\.exe)?$/i;
const DELETE_CALL = /\b(rmSync|rmdirSync|rmdir|rm|rmtree|removedirs|unlinkSync|unlink|remove|Remove-Item)\s*\(/;

// extra: optional (token) => what | null for paths only known at run time (a custom evidenceDir, E4)
// inProject: false outside a Stack Agent project. The git rules and the workflows-folder rule are about a repo's
// own gates, so they apply only where Stack Agent is set up; the rules about Stack Agent's own files always apply.
export function classify(command, depth = 0, extra = () => null, { inProject = true } = {}) {
	const protectedAt = (t) => protectedWhat(t) ?? extra(t);
	const text = String(command ?? "");
	if (SESSIONS_MENTION.test(text) && (CHANGES_FILES.test(text) || splitSegments(text).some((s) => hasInlineScript(tokenize(s)))))
		return askForProtected("the Stop hook's session record");
	for (const segment of splitSegments(String(command ?? ""))) {
		const tokens = tokenize(segment);
		if (tokens.includes("--allow-increase"))
			return { decision: "ask", reason: "`--allow-increase` raises the guard baseline and accepts new rule violations. A human must approve it." };
		const redirected = tokens.flatMap((t, i) => {
			const glued = /^\d*>>?(.+)$/.exec(t);
			if (glued) return [glued[1]];
			return /^\d*>>?$/.test(t) && tokens[i + 1] ? [tokens[i + 1]] : [];
		});
		const redirectHit = redirected.find((t) => protectedAt(t));
		if (redirectHit) return askForProtected(protectedAt(redirectHit));
		const target = tokens.find((t) => protectedAt(t));
		// an interpreter given its program as an argument: node -e / -pe / --eval=..., python -c / -Ic, py -3 -c, deno eval
		const inlineScript = hasInlineScript(tokens);
		if (target && tokens.some((t) => WRITERS.test(t))) return askForProtected(protectedAt(target));
		const deletesWorkflows =
			(tokens.some((t) => DELETERS.test(t)) && tokens.some((t) => WORKFLOWS_FOLDER.test(t))) ||
			(inlineScript && DELETE_CALL.test(segment) && workflowsFolderMentioned(segment));
		if (deletesWorkflows && inProject)
			return { decision: "ask", reason: "this deletes the folder holding the Stack Agent CI workflow, the check that still holds when the hooks do not. A human must approve it." };
		// the raw segment too: tokenizing drops a backslash inside double quotes ("\e"), but Python keeps it in the path
		const scripted = inlineScript && ([...tokens, segment].map(protectedMentioned).find(Boolean) ?? tokens.map((t) => extra.mentions?.(t)).find(Boolean));
		if (scripted) return askForProtected(scripted);
		const shellAt = tokens.findIndex((t) => NESTED_SHELLS.test(t));
		if (shellAt !== -1 && depth < 3) {
			const inner = tokens.slice(shellAt + 1).filter((t) => !/^-(c|Command|EncodedCommand|NoProfile|NonInteractive|lc|ic)$/i.test(t) && !/^\/c$/i.test(t)).join(" ");
			const nested = classify(inner, depth + 1, extra, { inProject });
			if (nested) return nested;
		}
		const git = inProject && parseGit(tokens);
		if (git) {
			const verdict = classifyGit(git);
			if (verdict) return verdict;
		}
	}
	return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const input = readHookInput();
	const ctx = projectContext(input);
	const verdict = SHELL_TOOLS.includes(input.tool_name) ? classify(input.tool_input?.command, 0, ctx.guard, { inProject: Boolean(ctx.root ?? findUp(input.cwd ?? process.cwd(), ".stack-agent/guard.config.json")) }) : null;
	if (verdict) {
		process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } }));
	}
	ctx.record();
}
