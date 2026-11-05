---
name: to-questionnaire
description: Turn a decision you cannot answer alone into a questionnaire for someone else to fill in.
disable-model-invocation: true
---

# Turn an open decision into a questionnaire

Some decisions need knowledge the user does not have. This skill writes a Markdown **questionnaire** that the user hands to one person, who fills it in alone or answers it together with the user in a meeting. The recipient holds the knowledge; the document pulls it out.

**Interview the user about the send, not the subject.** The user can always answer who it goes to and what they need back. The questions in the document then aim at the gap between what the recipient knows and what the user needs.

## 1. Who is it going to?

Ask in one exchange: the recipient's role, expertise, and relationship to the user. This sets the tone and how much context the document must carry. Done when you know who the recipient is and what they know that the user does not.

## 2. What do you need back?

Ask in one exchange: the decisions or facts the user cannot settle alone and needs from this person. Done when you hold a concrete list of what the user must be able to do or decide afterwards.

## 3. Write the questionnaire

Draft questions that aim at the gap found in sections 1 and 2, using the structure below. Write the file to `to-questionnaire-<slug>.md` in the current directory (slug from the topic). If that folder is a git repository, say that the file is new and untracked; do not add or commit it.

## Document structure

Frame it as a discovery questionnaire: the user lacks context, the recipient holds it. Put the most important questions first, because an async reader may give only one pass. Once there are more than a handful of questions, group them under `##` headings by theme. Use this template:

<questionnaire-template>

# <Questionnaire title>

**Purpose:** why this questionnaire exists and the decision riding on it.

**From:** <the user>, **To:** <the recipient>, **How your answers will be used:** <where they go>

## Context

One paragraph for a recipient who was not in the user's head. Enough to answer well, not a page.

## How to answer

Deadline and rough effort. Partial answers and "I don't know" are useful: flag anything you are unsure of instead of skipping it.

## <Theme heading>

One `##` section per theme. Under each, its questions, most important first. Each question is one idea, never compound, with an answer stub directly beneath. Add a one-line _why this matters_ only where the question could be misread or invite a throwaway answer.

<question-example>
### What load is the system expected to handle at launch?

_Why this matters: it decides whether we provision for burst traffic now or defer it._

>
</question-example>

## Anything else?

A closing catch-all: is there anything we did not ask that we should know?

</questionnaire-template>

## Done when

- The file exists, and every item named in section 2 is covered by at least one question.
- Each question holds one idea and has an answer stub.
- The context paragraph can be read without the chat.

## Report

Give the path of the file, who it is for, and which items from section 2 it covers. Say plainly if an item could not be turned into a question.
