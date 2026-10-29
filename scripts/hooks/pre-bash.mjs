#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeVerdict, renderVerdict } from "../lib/messages.mjs";
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
	// a word is any run of plain characters and quoted pieces, as in a shell: key="two words" is one token, key=two words.
	// An unterminated quote falls back to the rest of the word as written.
	for (const m of segment.matchAll(/(?:"(?:\\.|[^"\\])*"|'[^']*'|[^\s"'])+|\S+/g))
		tokens.push(m[0].replace(/"((?:\\.|[^"\\])*)"|'([^']*)'/g, (_, dq, sq) => (dq !== undefined ? dq.replace(/\\(.)/g, "$1") : sq)));
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
	// git accepts any unambiguous prefix of a long option (--no-verif for --no-verify, --del for --delete), so long
	// options are matched by prefix down to the shortest form git takes for that subcommand
	const long = (name, min) => rest.some((t) => t.length >= min && name.startsWith(t.split("=")[0]));
	if (globals.some((g) => /^(-c|--config-env)=?core\.hookspath=/i.test(g)))
		return makeVerdict("deny", "deny.hookspath-override");
	// an alias that skips the hooks, set for one command (-c alias.ci=...) or for good (git config alias.ci ...)
	if (globals.some((g) => /^-c=?alias\./i.test(g) && ALIAS_SKIPS_HOOKS.test(g)) || (sub === "config" && rest.some((t) => /^alias\./i.test(t)) && rest.some((t) => ALIAS_SKIPS_HOOKS.test(t))))
		return makeVerdict("deny", "deny.alias-skips");
	// `git config core.hooksPath x` (or `git config set ...`) turns the hooks off for every later command; reading or
	// unsetting it does not
	if (sub === "config" && rest.some((t) => /^core\.hookspath$/i.test(t)) && !rest.some((t) => /^(--get|--get-all|--get-regexp|--unset|--unset-all|--list|-l|get|unset|list)$/.test(t)))
		return makeVerdict("deny", "deny.hookspath-config");
	if ((sub === "commit" || sub === "push" || sub === "merge") && env.some((e) => HOOK_DISABLING_ENV.test(e)))
		return makeVerdict("deny", "deny.env-hooks", { env: env.join(" "), sub });
	if ((sub === "commit" || sub === "push" || sub === "merge" || sub === "am" || sub === "rebase") && long("--no-verify", 8))
		return makeVerdict("deny", "deny.no-verify", { sub });
	if (sub === "commit" && shortFlags(rest).includes("n"))
		return makeVerdict("deny", "deny.commit-n");
	if (sub === "push") {
		const forced = shortFlags(rest).includes("f") || rest.some((t) => t === "--force" || t.startsWith("--force-") || /^\+/.test(t) || /^[^-][^:]*:\+/.test(t)) || long("--mirror", 3);
		if (forced) return makeVerdict("ask", "ask.force-push");
		const deletes = shortFlags(rest).includes("d") || long("--delete", 4) || long("--prune", 5) || rest.some((t) => /^:[^:]+$/.test(t));
		if (deletes) return makeVerdict("ask", "ask.push-delete");
	}
	if (sub === "reset" && (long("--hard", 3) || long("--merge", 4) || long("--keep", 3)))
		return makeVerdict("ask", "ask.reset-hard");
	if (sub === "clean" && (shortFlags(rest).includes("f") || long("--force", 3)))
		return makeVerdict("ask", "ask.clean");
	const onlyUnstages = sub === "restore" && (rest.includes("--staged") || rest.includes("-S")) && !rest.includes("--worktree") && !rest.includes("-W");
	if ((sub === "checkout" || sub === "restore") && !onlyUnstages && rest.some((t) => t === "." || t === ":/" || t === "*"))
		return makeVerdict("ask", "ask.discard-all");
	// -d alone refuses to delete a branch whose commits are not merged anywhere; -D or --delete --force deletes them
	if (sub === "branch" && (shortFlags(rest).includes("D") || ((shortFlags(rest).includes("d") || long("--delete", 5)) && (shortFlags(rest).includes("f") || long("--force", 6)))))
		return makeVerdict("ask", "ask.branch-delete");
	// these point an existing branch somewhere else; its old commits survive only in the reflog. -M (force rename)
	// is left alone: `git branch -M main` is the usual first step of a new repository.
	const branchFlags = shortFlags(rest.filter((t, i) => !/^--(sort|format|contains|no-contains|merged|no-merged|points-at|set-upstream-to)$/.test(rest[i - 1] ?? "")));
	const forceMoves =
		(sub === "branch" && (/[fC]/.test(branchFlags) || long("--force", 6))) ||
		(sub === "checkout" && shortFlags(rest).includes("B")) ||
		(sub === "switch" && (shortFlags(rest).includes("C") || long("--force-create", 9)));
	if (forceMoves)
		return makeVerdict("ask", "ask.branch-force-move", { sub });
	if (sub === "stash" && (rest[0] === "clear" || rest[0] === "drop"))
		return makeVerdict("ask", "ask.stash-drop");
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
// git reads config from the environment too: GIT_CONFIG_PARAMETERS carries "key=value" pairs and GIT_CONFIG_KEY_<n> names
// a key, so either one can set core.hooksPath without a -c on the command line
const GIT_CONFIG_HOOKSPATH = /^(?:export\s+)?GIT_CONFIG_(?:KEY_\d+|PARAMETERS)=.*core\.hookspath/i;
// an alias that runs a commit or push without its hooks: `git ci` then needs no flag at all
const ALIAS_SKIPS_HOOKS = /--no-verif|\b(?:commit|push|merge|am|rebase)\b(?:\s+\S+)*?\s+-[a-zA-Z]*n[a-zA-Z]*(?:\s|$)/;
// the repo's local git hooks are in no diff, so changing one turns the gate off without a trace (.husky is committed,
// so it is reviewed like any other file and is left alone)
const GIT_HOOKS = /(?:^|[^\w.-])\.git[\\/]hooks(?:[\\/]|[^\w.-]|$)/;
const HOOK_CHANGERS = /^(chmod|chown|ln|install|touch|rename|ren|move|mv|cp|rm|del|erase|unlink|rmdir|rd|ri|shred|truncate|sed|perl|ruby|tee|dd|find|Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|Clear-Content|Rename-Item|sc|ac)(\.exe)?$/i;
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
			return makeVerdict("ask", "ask.allow-increase");
		const redirected = tokens.flatMap((t, i) => {
			const glued = /^\d*>>?(.+)$/.exec(t);
			if (glued) return [glued[1]];
			return /^\d*>>?$/.test(t) && tokens[i + 1] ? [tokens[i + 1]] : [];
		});
		const redirectHit = redirected.find((t) => protectedAt(t));
		if (redirectHit) return askForProtected(protectedAt(redirectHit));
		if (inProject) {
			if (tokens.some((t) => GIT_CONFIG_HOOKSPATH.test(t)))
				return makeVerdict("deny", "deny.hookspath-gitconfig-env");
			if (tokens[0] === "export" && tokens.slice(1).some((t) => HOOK_DISABLING_ENV.test(t)))
				return makeVerdict("deny", "deny.export-env", { env: tokens.join(" ") });
			const hooksTouched = redirected.some((t) => GIT_HOOKS.test(t)) || (tokens.some((t) => GIT_HOOKS.test(t)) && tokens.some((t) => HOOK_CHANGERS.test(t))) || (hasInlineScript(tokens) && GIT_HOOKS.test(segment));
			if (hooksTouched)
				return makeVerdict("ask", "ask.git-hooks");
		}
		const target = tokens.find((t) => protectedAt(t));
		// an interpreter given its program as an argument: node -e / -pe / --eval=..., python -c / -Ic, py -3 -c, deno eval
		const inlineScript = hasInlineScript(tokens);
		if (target && tokens.some((t) => WRITERS.test(t))) return askForProtected(protectedAt(target));
		const deletesWorkflows =
			(tokens.some((t) => DELETERS.test(t)) && tokens.some((t) => WORKFLOWS_FOLDER.test(t))) ||
			(inlineScript && DELETE_CALL.test(segment) && workflowsFolderMentioned(segment));
		if (deletesWorkflows && inProject)
			return makeVerdict("ask", "ask.workflows-delete");
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
		process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: verdict.decision, permissionDecisionReason: renderVerdict(verdict, ctx.lang) } }));
	}
	ctx.record();
}
