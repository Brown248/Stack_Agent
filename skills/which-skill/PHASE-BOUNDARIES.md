# Phase boundaries

A **phase** is a chunk of work inside one conversation: the grilling, the build, the review. A phase ends when the user thinks "that part is done". The edge between two phases is the **phase boundary**, and it is the only place to decide how to carry context forward.

Mid-phase there is nothing to decide: carry on, or send the remaining work to a subagent. Compacting mid-phase makes Claude lose the thread of what it was doing.

## 1. The five options

| Option | What it does |
| --- | --- |
| Carry on | Stay in the conversation. No change. |
| `/compact [focus]` | Replace the history with a summary. Free text after the command says what the summary must keep. |
| `/clear` | Start an empty conversation. The old one can be reopened with `/resume`. |
| Handoff note | Write a short file with the `handoff` skill (type `/stack-agent:handoff`), then start a new session from it. |
| Subagent | Claude launches one with the `Agent` tool. It starts with an empty context, sees none of the conversation, and returns a report. |

## 2. Decide in this order

Take the first question that answers yes.

1. **Can the next phase carry on here?** Yes when the next phase needs this one as it happened (for example, grilling into building wants the reasoning word for word, not a summary), or when `/context` shows enough room left for the next phase. Carrying on costs nothing and loses nothing, so rule it out first.
2. **Is nothing here needed next?** If the exploration, the decisions, and the dead ends are all disposable, run `/clear`. Check first: a cleared conversation takes the reason behind each choice with it, and rereading the diff does not bring the reason back.
3. **Is the work leaving this conversation?** Write a handoff note when the next session is in another tool, another folder or repo, with another person, or is a side task forked off mid-phase. A note is for carrying work somewhere. If nothing is travelling, skip it.
4. **Is the next task tight enough to run unattended?** Then give it to a subagent and leave this conversation untouched. A review that reads a diff and reports is the usual case. The brief must hold everything the subagent needs, because it sees nothing else.
5. **Otherwise, `/compact` with a focus.** Same tool, same folder, and the user must stay in the loop: this is where the list often ends. Name what the next phase needs, for example `/compact keep the decisions and the failing test; we are about to review this area`.

`/compact` is the fallback, not the first move. Starting there is how a fresh-looking session ends up confident about a decision the summary flattened.

## 3. What each move costs

Every option except carrying on swaps the conversation as it happened for a summary of it.

| Source | Detail kept | Noise | Room left |
| --- | --- | --- | --- |
| The conversation itself | All of it | A lot | Little |
| A summary or a handoff note | Some of it | Less | Plenty |

Pay that loss only when staying costs more than it saves. To judge that, check `/context` rather than guessing: it shows how much of the window is used.

## 4. These are judgement calls

The same boundary can go two ways on two days. What matters is asking the questions in order and asking them at the boundary, not halfway through the work.
