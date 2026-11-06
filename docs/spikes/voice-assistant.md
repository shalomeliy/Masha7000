# Spike: voice assistant (2026-11-06)

**Question:** can Claude turn the manager's spoken Hebrew into job cards for this app, ask only for what is missing, take corrections, and stay inside a $5/month budget?

**Code:** `spikes/voice-assistant/spike.mjs` (throwaway). A catalog shaped like the Drive lists (roles, certifications, shift kinds, work kinds, places, job descriptions) goes in the system prompt; two strict tools: `ask_user` and `propose_jobs`. Nothing is written anywhere; the proposal is only printed.

**Script (the user's own example plus two follow-ups):**
1. "אני צריך 3 מטפסים, לא בעצם מספיק לי 2 מטפסים וטכנאי מצלמות 1 לאילת אתר 123 וגם אתר דימונה 556, ואם חסר לך עוד ידע תשאל אותי"
2. "ביום ראשון, לינה, החלפת מצלמה"
3. "תוסיף גם חשמלאי אחד רק לדימונה"

## Results

| | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Turn 1 | asked for date, shift kind, job description | same |
| Self-correction 3 -> 2 climbers | kept 2 | kept 2 |
| "מטפס" mapped to role טפסן | yes | yes |
| Two places -> two cards | yes | yes |
| "לינה" -> לילה+, "יום ראשון" -> 2026-11-08 | yes | yes |
| Correction only for Dimona | yes | yes |
| Spoken summary | correct, a bit long, reads the ISO date | correct, shorter, "8.11" |
| Time per turn | 1.9-2.6 s | 1.8-3.7 s |
| Cost of the 3 turns | $0.0016 | $0.027 |

## Verdict: GO

Both models got every field right on the user's example. Haiku 5.5 is about 17x cheaper: at $5/month it allows roughly 3,000 conversations, versus about 180 with Sonnet 5.5. Recommended: Haiku 5.5 for phase 1 commands (summary wording fixed in the prompt: date as "יום ראשון 8.11"), and a stronger model only for the phase 2 advisor, where answers are rarer and harder.

Not tested yet: real speech on the phone (the existing `DictationField` already works there), the other actions (workers, assigning, lists), and the server path (`api/`, owner only, CSP).
