---
name: free-commands
description: Teach the Masha7000 (Shaly) voice assistant to do one more kind of request by itself, free and without Claude, by learning it from what Claude did and the manager confirmed. Use when the user asks that a voice action stop costing money, says "it went to Claude again", or asks to make another action free (leave, constraints, assign a named worker, move or close a job). Applies only to the voice assistant (src/lib/freeCommands.ts, src/pages/Voice.tsx).
---

# Free commands: learn from Claude, then do it free

The user's goal (2026-11-07): the app's Anthropic credit is spent only on what really needs a model. Every action Claude did once (and the manager confirmed) should, the next time it is said the same way with other names, days and places, be done by the app itself, free and instantly. Background and measurements: `docs/spikes/free-commands.md`, `docs/spikes/learn-actions.md`, HANDOFF "free voice commands".

## How it works today (read before changing)

- `src/lib/freeCommands.ts`:
  - `find(said, data, aliases, now, protect)` explains every word it can from the app's own lists: days (היום, מחר, ביום שלישי, ראשון הקרוב, עד מחר, 15.11, בעוד יומיים, בעוד 3 ימים), kinds (יום, לילה, כולל לינה), places, workers (see "Worker names" below), roles with a count (a word or digits), job types. What is left (`rest`) are action words or unknown words.
  - `exampleAction(proposal, asked)` decides what a confirmed Claude proposal teaches and stores it on `AssistantExample.action` (Drive, `assistant_examples.json`). Types today: `job` (one new job) and `sick` (one worker sick, as status or as a dated absence with note מחלה).
  - `learn(examples, data)` turns them into action words per example, aliases (a word Claude mapped to a role, "מטפסים" = טפסן) and required fields.
  - `handleFree(text, data, learned, now)`: fixed core first (screens, the five assistant buttons, who works on a day), then each learned action. `continueJob` answers a local question for a missing detail. `pickedOption` takes a spoken pick of a solution. `sickPlan` is built in from the first time.
  - `splitFree(text, data, learned, now)`: one long sentence with several requests ("יוסי חולה מחר ותפתח עבודה ביום שלישי בערד, ומה עם השבוע הבא?"). It cuts at punctuation, joining words (וגם, ואז, ובנוסף, אחר כך) and a verb or question word with ו in front (`STARTS`: ותפתח, ותבדוק, ומה; never ותשבץ, which belongs to a job). Longest known run first; a "ו" before a name splits only when every piece is known ("יוסי חולה היום ודני חולה היום", but not "יוסי ודני חולים"). A part that the app would ask about, or that needs the planner's options, counts as unknown. When an unknown part starts like a correction (`CORRECTION`: לא, רגע, בעצם...) or is only details with no action ("בערד 17"), the whole sentence goes to Claude. `knownResult` joins the known proposals (`mergeProposals`, one summary, one "לאשר?"), `claudePart` writes Claude's turn: only the unknown part, with the whole sentence as context and "do not do the rest".
- `src/pages/Voice.tsx` calls it only while Claude is not in the conversation, Hebrew only. Anything not fully understood goes to Claude with everything said so far as one turn. Local proposals are checked with `proposalErrors`; nothing is saved without the manager's yes. The counter (`assistant.usage`) counts a paid turn only when Claude answered.

### A long sentence in the screen (`actSplit` in `Voice.tsx`)

- All parts known: one free proposal, read back once, אשר/תקן as usual (counted free).
- Some parts unknown: the known proposal waits in `localPart`; only the unknown part goes to Claude and to the log (`said` = that part, `reason` starts "part of a long sentence; done free: ..."). Claude's proposal is joined with the waiting one in `offer` (one read-back); on a yes only Claude's part is learned (`claudeProposal`). Claude answers without a proposal, fails or errors: the waiting part is offered alone. A correction (תקן) of a joined proposal hands everything to Claude ("כלול גם אותם"), so nothing is lost or done twice.

## Always look for a cheaper way (the user's rule, 2026-11-08)

Every run of this skill, before adding one more action, look over the log for these, cheapest first, and do the ones that apply:

1. **A long sentence that went to Claude whole although parts of it are known.** Read `reason` and `understood`: when a known action is inside, find why `splitFree` did not cut it (a joining word or a verb with ו not in `CHUNKS`/`JOINERS`/`STARTS`) and add it, with a test.
2. **Parts that went to Claude again and again** (`reason` starting "part of a long sentence"): the `said` there is exactly the request still to teach. Count them like whole sentences.
3. **A repeated combination of known actions** said as one sentence (sick + a replacement, a job + who works that day): when the split cannot do it (the parts depend on each other, "במקומו"), teach it as one action of its own.
4. **A known action refused for one word** (`not understood: "X"` with everything else explained): teach the word (an alias, a filler, a date form) rather than a new action.
5. Only then a new action type, as below.

Report in the commit message and in HANDOFF which of these were found and done, and how many log entries each one would have made free.

## Worker names (the user's rule, 2026-11-07)

Names are matched by closeness, never only by exact spelling: typos, speech-recognition errors and spelling variants, Hebrew and English. `src/lib/nameMatch.ts` brings both names to Hebrew letters (an English name by its sound: "Yossi" = יוסי, a card written "David" = דוד) and measures the difference: a vowel letter (א ה ו י ע) or a sound-alike letter (כ/ק/ח, ת/ט, ס/ש, א/ע/ה, ב/ו) costs half, anything else one. How much a name may differ depends on its length (`nameLimit`: 2 letters exact, 3 letters half, 4-5 one, longer more).

- Exact first names are taken first; the rest by closeness at the end, after places, dates, roles and job types took their words. Common words (`COMMON`, `NOT_NAMES`) and learned action words (`Learned.protect`) are never read as names.
- A last name said after the first decides between workers of one first name.
- One worker clearly closest: him. Two or more about equally close (within half): `find` puts them in `unsure`, and the action asks "למי התכוונת, X או Y?" (`Local` kind `which`; the answer goes to `continueWho`, which rebuilds the first sentence with the full name). An exact name always beats a near one.
- No worker close enough, where the action needs one ("גלעד חולה"): "לא מצאתי עובד בשם ...", free. Never a guess.
- Every new action that names a worker uses `find`'s `workerIds` and `unsure` the same way (look at `sickWho`).

## Values are slots, the template is the action (the user's rule, 2026-11-07)

What is learned is the action type and its action words. Every value said in the example (names, dates, places, counts, descriptions) is a slot that can change next time. In `learn`, remove from the action words:

- everything `find` explained (dates, places, workers, roles, kinds, job types),
- the words of the action's own values even when the lists did not know them then (`slotWords`: the location and description of a job, the worker's name however spelled),
- anything with digits (`isValue`: a count, a date like 15.11, a site number).

So an example said with "ב-15.11 בבאר שבע 9" teaches only "תפתח עבודה". When a new kind of value comes up (a time, a month name), teach `find` to read it as a slot rather than letting it become an action word.

## Adding one more action

1. **Pick the action from real use.** Read the "what went to Claude" log first: `node scripts/claude-log.mjs` (needs `CLAUDE_LOG_TOKEN` in `.env.local`), or ask the owner to copy it from Settings > העוזר הקולי > מה הלך ל-Claude. Each entry has what was said, why the free path refused it (`whyNotFree`), what it understood, what Claude did and whether it was confirmed. Pick the most frequent refused shape. The dev-only line under the switch on the assistant screen shows how many actions of each type were learned. When you add an action, teach `whyNotFree` its reasons too.
2. **Write the test set first** in `src/lib/freeCommands.test.ts`, like the existing ones:
   - one or two examples as Claude did them (`ex(said, proposal)`),
   - 5-8 new requests of the same kind with other details and word order, with the exact expected proposal,
   - names said with a typo, in English and close to two workers (expect `which`), and a name close to nobody (expect "לא מצאתי"), when the action names a worker,
   - 6-10 requests that must still go to Claude (other verbs, names where none belong, two requests in one, questions, a place not in the lists). This set must stay at zero wrong actions.
3. **Teach `exampleAction`** to recognize the confirmed proposal as this action (only that action; notes, lessons and a new list item may come with it). Add the type to `ExampleAction` in `src/types/models.ts` with `said` and only the fields needed to rebuild it.
4. **Teach `learn`** what to keep: the action words (rest minus explained words minus the action's own values minus free text, see "Values are slots"), aliases, required fields.
5. **Write the handler** next to `learnedJob` / `learnedSick`: the request is handled only when every action word of a learned example was said and nothing is left unexplained (free text only in a single run of words, and only for a free-text field). Build the proposal with `normalizeProposal({})` plus the changes, and a Hebrew summary ending in "לאשר, או שיש עוד תיקון?". When the action can leave a job short of people, offer the planner's options (`solve`) at once, as `learnedSick` does, and put the action's own changes in `Advice.extra`.
6. **Wire it** into `handleFree` (order: fixed core, then the most specific learned actions).
7. **Prove it:** `npm run verify`, then in the dev server with the fake Drive (`localStorage.setItem('dev.mockDrive','1')`, reload twice; examples can be injected into `sessionStorage['dev.mockDrive.files']` as `assistant_examples.json`): the new request is done with the counter showing only "בחינם", and the saved data is right. Clean the test data after.

## Rules

- **Weekly routine.** A scheduled weekly session runs this skill on its own (reads the log with `node scripts/claude-log.mjs --last 200`, which needs `CLAUDE_LOG_TOKEN`). With no log access or nothing repeated (at least twice) it changes nothing and says so. Otherwise it teaches at most the two most frequent shapes, runs `npm run verify`, commits only its own files and pushes to master.
- **Never call Anthropic to test this.** The real-assistant switch on the assistant screen is the owner's only (CLAUDE.md "Never spend the API key locally"). Learning is tested with injected examples.
- **Safety beats coverage.** If a sentence is not fully explained, it goes to Claude. A wrong free action is worse than a cent.
- **Hebrew only.** In another app language everything goes to Claude.
- **Built in when obvious.** An action with a fixed, unambiguous shape (like "<worker> חולה <when>") may be built in from the first time, with learned phrasings added to it.
- **Same rule for Claude.** If the free path saves an action in a specific form, tell Claude the same rule in `api/_lib/assistant.ts`, so what Claude does can be learned and both paths save the same data.
- Reply texts here are Hebrew and not translated (the free path runs only in Hebrew). Any new text shown in every language goes through `tx()` and all 14 locale files.
- Update HANDOFF "free voice commands" with the new action and its test numbers.
