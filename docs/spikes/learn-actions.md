# Spike: learn actions from Claude, to do them free next time (2026-11-07)

**User request.** When Claude once handled a request (for example opening a job, with a conversation to complete the details), Shaly should learn what the action needs and, the next time, do it alone and free, after one or a few times. For every action where possible.

**Riskiest assumption.** From one or two confirmed conversations Shaly can learn enough to handle new requests of the same kind with other details and another word order, and never take a different request for that action.

**What was built.** `spikes/learn-actions/learn.ts`, for "new job" (the hardest common action):
- Shaly finds by itself everything its own lists explain: days (היום, מחר, ראשון הקרוב, ביום שלישי), kinds (יום, לילה, כולל לינה), places, roles with a count (שני מטפסים, טכנאי מצלמות אחד), known job types.
- From each confirmed example it keeps the action words (what is left: "תפתח עבודה", "ותשבץ לי מישהו" = also assign), new words Claude understood that the lists lack (learned alias: "מטפסים" = role טפסן), and which fields the action needs (the ones every example filled).
- A new sentence is done alone only when every action word of a learned example is said and nothing is left unexplained except the description. Missing fields become a question ("באיזה יום?"). A worker's name, another verb, or unexplained words: Claude.

**Result** (`learn.test.ts`, learned from 2 examples):

| Set | Result |
|---|---|
| 8 new job requests: other days, places, kinds, roles, counts, order | 5 done alone and right, 2 asked the right missing detail, 1 sent to Claude (a new phrasing, "עבודה חדשה") |
| That new phrasing, after Claude handled it once | learned: the next request said that way was done alone and right |
| 8 other requests (sick worker, move, close, delete, a rule, a question, a job naming workers) | 8 / 8 sent to Claude, none acted on |

Alias learned from Claude: "מטפס" = טפסן. Fixed during the spike: plural roles (חשמלאים), and a loose match that took "תעביר / תסגור / תמחק את העבודה" for a new job (now every learned action word must be said).

**Verdict: GO.** Safe by construction: nothing runs without the manager's spoken "yes" after the summary, which already exists; anything unsure goes to Claude, and each new phrasing is learned after one Claude turn.

**For the build.**
- The confirmed examples on Drive (`assistantExamples`) keep only what was said and the summary; they must also keep the confirmed action (the job fields) to learn from.
- Start with: the free fixed core (screens, the five buttons, who works on a day, `docs/spikes/free-commands.md`), learned new-job requests with local questions for missing details, and exact repeats of other simple actions. Then add actions one at a time with the same method (worker sick / on leave, constraints, assign a named worker), each with its own test set.
- Unknown: how much of the manager's real use this covers; only his own use will show it. A small counter (free vs paid turns) on the assistant screen would make it visible.
