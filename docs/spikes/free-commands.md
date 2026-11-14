# Spike: free voice commands (2026-11-07)

**Question.** Can Shali recognize simple, common voice commands by itself (free, instant) and send only the rest to Claude (paid, about 0.1-1 cent a sentence)?

**Riskiest assumption.** Fixed rules can catch a useful share of what the manager really says, without ever doing a wrong action on a sentence that needed Claude.

**What was built.** `spikes/free-commands/match.ts`: a sentence is handled locally only when the whole of it matches a known command (open a screen, press one of the assistant's buttons: share the week, urgent job, new job, request constraints, join link; "who works" on today / tomorrow / a weekday, answered from the data). Anything extra (a name, a place, a problem, two requests) goes to Claude. `match.test.ts` measures it.

**Result.**

| Set | Result |
|---|---|
| 25 simple commands the rules were written for | 25 / 25 free |
| 22 sentences that need Claude (details, names, problems, two requests) | 0 / 22 wrongly handled: no wrong action |
| 20 natural variations written after the rules, not tuned on | **7 / 20 free** (35%) |

The safety part works: requiring the whole sentence to match never caught a hard sentence. The coverage part does not hold up: everyday variations ("תפתחי את היומן", "מה יש לנו מחר", "רשימת עובדים", "עבודה דחופה", "אני רוצה לפתוח עבודה חדשה") slip past hand-written rules. Each new phrasing needs a new rule, forever.

**Verdict: CHANGE.** Keep the safe matcher for a small fixed core, but grow it from the manager's own words instead of from rules written in advance:

1. Free core: the rules above (screens, the five buttons, who works on a day).
2. Learned shortcuts: when Claude answers a sentence with a simple action (open a screen, press a button, who works), Shali saves that exact sentence (normalized) as a shortcut on the manager's Drive. The next time he says the same thing, it runs free and instantly. His habits repeat, so the share of free commands grows with use.
3. Optional, separate: send Claude a smaller slice of the data per sentence, so the paid ones cost less.

Unknown, cannot be measured here: what share of his real sentences are simple. The approved requests saved on his Drive (`assistantExamples`) could answer it later.

Not built into the app. Waiting for the user's decision.
