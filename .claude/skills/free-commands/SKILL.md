---
name: free-commands
description: Teach the Masha7000 (Shaly) voice assistant to do one more kind of request by itself, free and without Claude, by learning it from what Claude did and the manager confirmed. Use when the user asks that a voice action stop costing money, says "it went to Claude again", or asks to make another action free (leave, constraints, assign a named worker, move or close a job). Applies only to the voice assistant (src/lib/freeCommands.ts, src/pages/Voice.tsx).
---

# Free commands: learn from Claude, then do it free

The user's goal (2026-11-07): the app's Anthropic credit is spent only on what really needs a model. Every action Claude did once (and the manager confirmed) should, the next time it is said the same way with other names, days and places, be done by the app itself, free and instantly. Background and measurements: `docs/spikes/free-commands.md`, `docs/spikes/learn-actions.md`, HANDOFF "free voice commands".

## How it works today (read before changing)

- `src/lib/freeCommands.ts`:
  - `find(said, data, aliases, now)` explains every word it can from the app's own lists: days (היום, מחר, ביום שלישי, ראשון הקרוב, עד מחר), kinds (יום, לילה, כולל לינה), places, workers (first name, last name up to one letter off), roles with a count, job types. What is left (`rest`) are action words or unknown words.
  - `exampleAction(proposal, asked)` decides what a confirmed Claude proposal teaches and stores it on `AssistantExample.action` (Drive, `assistant_examples.json`). Types today: `job` (one new job) and `sick` (one worker sick, as status or as a dated absence with note מחלה).
  - `learn(examples, data)` turns them into action words per example, aliases (a word Claude mapped to a role, "מטפסים" = טפסן) and required fields.
  - `handleFree(text, data, learned, now)`: fixed core first (screens, the five assistant buttons, who works on a day), then each learned action. `continueJob` answers a local question for a missing detail. `pickedOption` takes a spoken pick of a solution. `sickPlan` is built in from the first time.
- `src/pages/Voice.tsx` calls it only while Claude is not in the conversation, Hebrew only. Anything not fully understood goes to Claude with everything said so far as one turn. Local proposals are checked with `proposalErrors`; nothing is saved without the manager's yes. The counter (`assistant.usage`) counts a paid turn only when Claude answered.

## Adding one more action

1. **Pick the action from real use.** What did the manager say that still went to Claude? The dev-only line under the switch on the assistant screen shows how many actions of each type were learned. Ask the user for the sentence and Claude's summary if unclear.
2. **Write the test set first** in `src/lib/freeCommands.test.ts`, like the existing ones:
   - one or two examples as Claude did them (`ex(said, proposal)`),
   - 5-8 new requests of the same kind with other details and word order, with the exact expected proposal,
   - 6-10 requests that must still go to Claude (other verbs, names where none belong, two requests in one, questions, a place not in the lists). This set must stay at zero wrong actions.
3. **Teach `exampleAction`** to recognize the confirmed proposal as this action (only that action; notes, lessons and a new list item may come with it). Add the type to `ExampleAction` in `src/types/models.ts` with `said` and only the fields needed to rebuild it.
4. **Teach `learn`** what to keep: the action words (rest minus explained words minus free text), aliases, required fields.
5. **Write the handler** next to `learnedJob` / `learnedSick`: the request is handled only when every action word of a learned example was said and nothing is left unexplained (free text only in a single run of words, and only for a free-text field). Build the proposal with `normalizeProposal({})` plus the changes, and a Hebrew summary ending in "לאשר, או שיש עוד תיקון?". When the action can leave a job short of people, offer the planner's options (`solve`) at once, as `learnedSick` does, and put the action's own changes in `Advice.extra`.
6. **Wire it** into `handleFree` (order: fixed core, then the most specific learned actions).
7. **Prove it:** `npm run verify`, then in the dev server with the fake Drive (`localStorage.setItem('dev.mockDrive','1')`, reload twice; examples can be injected into `sessionStorage['dev.mockDrive.files']` as `assistant_examples.json`): the new request is done with the counter showing only "בחינם", and the saved data is right. Clean the test data after.

## Rules

- **Never call Anthropic to test this.** The real-assistant switch on the assistant screen is the owner's only (CLAUDE.md "Never spend the API key locally"). Learning is tested with injected examples.
- **Safety beats coverage.** If a sentence is not fully explained, it goes to Claude. A wrong free action is worse than a cent.
- **Hebrew only.** In another app language everything goes to Claude.
- **Built in when obvious.** An action with a fixed, unambiguous shape (like "<worker> חולה <when>") may be built in from the first time, with learned phrasings added to it.
- **Same rule for Claude.** If the free path saves an action in a specific form, tell Claude the same rule in `api/_lib/assistant.ts`, so what Claude does can be learned and both paths save the same data.
- Reply texts here are Hebrew and not translated (the free path runs only in Hebrew). Any new text shown in every language goes through `tx()` and all 14 locale files.
- Update HANDOFF "free voice commands" with the new action and its test numbers.
