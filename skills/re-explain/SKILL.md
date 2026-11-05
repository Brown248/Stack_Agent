---
name: re-explain
description: "Stop. That last message did not land: say it again, simply."
disable-model-invocation: true
---

# Say the last message again, simply

The user did not follow the last message. Rewrite it:

1. Start with two or three sentences of context: where the work stands and why this matters now.
2. Use short plain sentences of the kind ASD-STE100 Simplified Technical English uses: one idea per sentence, common words, active voice.
3. Use the terms in `GLOSSARY.md`. If the repo has a `GLOSSARY-MAP.md`, follow it to the right glossary. Do not invent a new word for something the glossary already names.

## Done when

- The rewrite repeats the same facts as the last message, with no new claims.
- Every domain term matches the glossary.
