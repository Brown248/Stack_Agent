// The refactor: wordfreq/core.py becomes wordfreq/counting.py and top_words becomes most_common_words, in the code and
// its imports. A second commit removes the code that explained an unreadable file (the try/except in cli.py), so one
// row of the map now describes behavior that no longer exists. The feature map (and the guard rule that names
// core.py) is left as it was.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const git = (...args) => execFileSync("git", ["-c", "user.name=eval", "-c", "user.email=eval@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: process.cwd(), stdio: "ignore" });

for (const f of ["wordfreq/cli.py", "wordfreq/__init__.py"]) fs.writeFileSync(f, fs.readFileSync(f, "utf8").replaceAll(".core import top_words", ".counting import most_common_words").replaceAll("top_words", "most_common_words"));
fs.writeFileSync("wordfreq/counting.py", fs.readFileSync("wordfreq/core.py", "utf8").replaceAll("top_words", "most_common_words"));
fs.rmSync("wordfreq/core.py");
git("add", "-A");
git("commit", "-qm", "wordfreq: move the counting into counting.py");

const cli = fs.readFileSync("wordfreq/cli.py", "utf8");
const guarded = /    try:\n        with open\(args\.file, encoding="utf-8"\) as f:\n            text = f\.read\(\)\n    except OSError as err:\n        print\(f"wordfreq: cannot read \{args\.file\}: \{err\.strerror\}", file=sys\.stderr\)\n        return 1\n/;
if (!guarded.test(cli)) throw new Error("setup: the unreadable-file handling in cli.py is not as expected");
fs.writeFileSync("wordfreq/cli.py", cli.replace(guarded, '    with open(args.file, encoding="utf-8") as f:\n        text = f.read()\n'));
git("add", "-A");
git("commit", "-qm", "wordfreq: let an unreadable file raise");
