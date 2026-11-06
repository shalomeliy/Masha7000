# Spike: assignment advisor, phase 2 (2026-11-06)

**Question:** given a hard staffing problem in the manager's words, does the model return up to 5 ranked, correct, doable solutions from the app's snapshot (v2 context), and at what cost and wait?

**Code:** `spikes/advisor/advisor.live.test.ts` (throwaway; v2 SYSTEM + an `advise` tool + "think like a veteran dispatcher" rules, effort medium). Data: 7 workers (one sick, one blocked on Monday, one electrician, two with the 40m certification), a tight coming week, a saved note "יוסי לא עולה לגובה 40 בלי דני לידו". Raw answers: `spikes/advisor/result-*.md`.

**Problems:**
1. Dani is sick, can't do Sunday's Eilat night (40m antenna job).
2. Tuesday has two night jobs (Mitzpe Ramon 40m, Arad) and not enough climbers.
3. Avi, the only electrician, can't on Monday; Dimona needs an electrician.

## Results

| | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Uses sick/blocked/certifications/the saved note | yes | yes |
| Ranked, different options with cost of each | 3-4 per problem | 4-5 per problem |
| Subtle catches | missed that the לינה runs into Monday (Avi blocked then); some contradictory sentences | caught it; flagged Dani at 2 nights that week; said "you do have enough climbers" |
| Mistakes | confused wording in 2 of 3 answers | none found that would mislead |
| Wait | 13-21 s | 11-23 s |
| Cost per problem | ≈ $0.002 | ≈ $0.034 |

Both missed that Gil is also an antenna technician (harmless here).

## Verdict: GO, with changes

- Use Sonnet for the advisor only (commands can stay on whichever model the user picks). At ≈ 3.4 cents per question, $5/month allows about 150 advisor questions.
- The wait is 10-20 seconds: the screen needs a clear "חושב על פתרונות..." state, and the spoken part should be short; the options show as cards.
- To make "do option 2" actually happen, the assistant needs two new actions it does not have today: put specific workers in an existing job, and move a job to another date. Without them, picking an option can only open the right screen.
