# Spec: "שבץ את השבוע" in one tap (v0.6 candidate)

Status: approved and built (2026-10-30). User decision: only today and later days are staffed; past days are never touched. Recommendations accepted: no "השבוע הבא" shortcut; night jobs first. No expert fan-out yet. `SECURITY NOT TRIGGERED`.

## Context and observed problem

- "שבץ" (`autoAssign`, `src/lib/planner.ts`) staffs one shift at a time, from inside the shift editor. Planning a week of 10 to 20 shifts means opening each one, pressing "שבץ" and saving.
- Order matters for fairness: each shift's pick counts the shifts already saved, so staffing them by hand in a random order gives a less fair week than staffing them in a fixed order.

## Target user and decision

The manager, after the workers' constraints for next week are in (Thursday, after the 17:00 deadline), building the whole week.

## Outcome

The week is staffed in one tap, the manager sees exactly what changed before anything is saved, and then fixes only the exceptions by hand.

## Goal

- A "שבץ את השבוע" button on the calendar week.
- It fills only empty places in open shifts of that week. It never removes or moves a worker the manager placed.
- A preview of every change, then "שמור הכול" or "ביטול".

## Non-goals

- Creating shifts. It staffs the shifts that exist; jobs still waiting in "לשיבוץ" stay there.
- Re-planning from scratch (clearing crews and picking again). Possible later as a separate, clearly worded action.
- Optimizing the whole week at once (a global solver). The current one-shift rule, run in a fixed order, is enough and stays explainable.

## Assumptions

- Shifts considered: in the shown week, not closed, starting today or later. Past days are left as they are.
- Order: by date, then night jobs before day shifts on the same date (night jobs are harder to staff and limited to 2 a week), then shifts with more places first. Each result is added to the records before the next shift is planned, so fairness and "already working at the same time" see it.

## Proposed experience

1. Calendar, next to the WhatsApp week button: "שבץ את השבוע". Disabled with "אין משמרות פתוחות לשבץ" when nothing in the week has an empty place.
2. Tap: a sheet "תצוגה מקדימה: שיבוץ השבוע" lists each shift that changes: day, place, the workers added (in green), and places still empty with the planner's reason (in red). Shifts already full are summarized as "5 משמרות כבר מאוישות".
3. Bottom: "שמור הכול" (one save) and "ביטול" (nothing changes).
4. After saving: the week status (`docs/specs/week-gaps.md`) shows what is left.

## System and data implications

- No new data. One save of `shifts.json` with all the changed shifts, so it either all saves or nothing does (the app's existing rollback on a Drive error).
- A new pure function: plan a list of shifts in order, carrying each result into the records the next one sees. It reuses `autoAssign` unchanged.
- The crew changes are not crew swaps (`swaps` stays for replacing a worker), so the archive does not log them.
- Once the shared-data work (`docs/specs/long-lived-sign-in.md`) adds the "file changed since read" check, a conflict on this save shows the same message as any save.

## Acceptance criteria

1. A week of 6 open shifts with empty places, after "שמור הכול", has the same crews as pressing "שבץ" and saving on each shift, one by one, in the stated order.
2. A worker the manager put in a shift is still there after the run, in the same shift.
3. No worker is placed in two shifts that run at the same time, and no worker a constraint blocks is placed.
4. A worker who reaches 2 night jobs in the week is placed in a third only when no other fitting worker exists, and the preview marks it "מעל 2 לילות".
5. "ביטול" saves nothing; reopening the calendar shows the week as before.
6. A Drive error on save shows the usual error with retry, and the week stays as before.
7. Closed shifts and shifts on past days are never changed.
8. On a phone, the preview sheet scrolls and its buttons stay reachable with one hand.

## States

- Nothing to plan: button disabled with the reason.
- Partial result: saved crews plus red lines for what is still missing; that is a normal outcome, not an error.
- Long week: the plan is computed in the browser in well under 200ms for 50 shifts and 50 workers (check in tests).

## Verification

Unit tests: order, carry-over between shifts, manager picks kept, equivalence with one-by-one (criterion 1). Browser check with mocked Drive.

## Open decisions

1. Include past days of the current week? Recommendation: no.
2. Should the button also offer "השבוע הבא" directly when it is Thursday or later? Recommendation: no, the week switcher already does it.
3. Is night-jobs-first the right order for the user's team, or should the more demanding certifications go first? Recommendation: night jobs first; places with rare certifications are already handled inside each shift.
