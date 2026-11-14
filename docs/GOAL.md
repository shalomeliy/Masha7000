# Goal: the voice assistant runs almost free

Set 2026-11-08 at the owner's request. Every session that touches the voice assistant (Shali) works toward this.

## The goal in one sentence

Shali keeps learning actions until almost every request is done by local code, for free, and Claude is called only for what is truly new or unclear.

## Why

- The Anthropic key pays real money and has a small monthly cap (`ASSISTANT_BUDGET_USD`, default $5). One local run used the whole month on 2026-11-06 (see CLAUDE.md "Never spend the API key locally").
- Local code answers at once; Claude takes seconds.
- The owner says the same kinds of things every day. A request shape that was paid for once should never be paid for again.

## What exists today (2026-11-08)

| Piece | Where | What it does |
|---|---|---|
| Free path, fixed core | `src/lib/freeCommands.ts` (`fixed`) | Open a screen, the five assistant buttons, "who works" on a day |
| Free actions, built in | `freeCommands.ts` (`handleFree`) | New job in any phrasing (to לשיבוץ when no date), new worker, worker sick with replacement options from the planner, pinned workers and their nearest free days, a description with several tasks split into a numbered list (`src/lib/taskList.ts`) |
| Free actions, learned | `exampleAction`, `learn()` | Every confirmed Claude proposal is kept as an example; its action words and aliases are learned, names/dates/places/counts become slots |
| Name matching | `src/lib/nameMatch.ts` | Names by closeness; two close = "למי התכוונת"; none close = "לא מצאתי", never a guess |
| Splitting long sentences | `splitFree` | Known parts done free, only the unknown part goes to Claude and to the log |
| Local solver | `src/lib/solvers.ts` | Staffing options computed locally; the model only ranks and words them |
| "What went to Claude" log | `src/lib/claudeLog.ts`, `api/claude-log.ts`, `scripts/claude-log.mjs` | Every paid conversation with why the free path refused it (`whyNotFree`), what Claude did, how it ended |
| Free vs paid counter | `usage()` / `countTurn()`, localStorage `assistant.usage` | Free and Claude turns this month, on the assistant screen |
| Budget meter | `api/_lib/budget.ts` | Money spent this month vs the cap, shown under the talk button |
| Teaching skill | `.claude/skills/free-commands/` | How to turn a logged request shape into a free action, cheapest fix first |
| Weekly routine | `docs/routines/weekly-free-commands.md` | Sunday 09:00: read the log, teach the two most repeated shapes |
| Spend guard | `api/_lib/spendGuard.ts` | Paid calls only on Vercel; dev uses the stand-in |

## Measurable targets

Proposed targets; the owner may change them.

| Measure | Read from | Now | By 2026-12-31 | By 2027-03-31 |
|---|---|---|---|---|
| Free share of turns in a month | assistant screen counter (`assistant.usage`) | not measured yet | 80% | 95% |
| Money spent in a month | budget meter | under $5 | under $1 | under $0.30 |
| Paid conversations per week | the log | unknown | 10 or fewer | 3 or fewer |
| A request shape paid for more than twice | the log | unknown | none | none |
| Wrong action done by the free path | `freeCommands.test.ts` "must still go to Claude" tests, owner reports | 0 | 0 | 0 |

The last line beats every other: a free path that does the wrong thing is worse than paying. When unsure, the free path sends it to Claude.

## The loop

1. The owner talks to Shali.
2. The free path tries first. What it cannot do goes to Claude and into the log with the reason.
3. On the owner's yes, the example is kept and its words are learned.
4. Once a week (or when the owner says "it went to Claude again"), a session reads the log and runs the skill `free-commands`: cheapest fix first (a split word, an alias, one unknown word), a new action type only last, and only for shapes seen at least twice.
5. The counter and the budget meter show whether it is working.

## Next steps, in order

Already in place (2026-11-08): `CLAUDE_LOG_TOKEN` is set in Vercel and `.env.local`, and the weekly routine "Masha7000: לימוד שבועי של פקודות חינמיות" runs every Sunday at 09:00 (first run 2026-11-08).

1. **Make the free share readable by a session.** Today the counter lives only in the phone's localStorage. Send the monthly free/paid count to the server next to the log, so the routine can report the number against the targets above.
2. **More actions free, in the order agreed with the owner (2026-11-07):** leave / constraints, assign a named worker, move a job, close a job, edit a worker's phone or certifications. Each with its own tests in `freeCommands.test.ts`.
3. **Free after Claude joins.** Today the free path runs only before Claude is in the conversation. Let a later sentence that is fully known (a new, separate request) be done free too.
4. **Advisor wording without the model.** The solver already finds the options; word the common cases from templates so a staffing question needs no paid call.
5. **Other languages.** The free path is Hebrew only; every other language is paid. Add the most used one only if the log shows it.

## Honest limit

Repeated request shapes become free. A truly new or unclear request will always go to Claude, and that is fine: the target is near zero, not zero. The model itself does not retrain; the app learns by code and saved examples.

## Rules that stay

- Never spend the app's key for development (CLAUDE.md). Tests use the stand-in only.
- Learned patterns keep only action words; values are slots (skill `free-commands`).
- Every proposal is read back and done only after the owner's yes, free or paid.
