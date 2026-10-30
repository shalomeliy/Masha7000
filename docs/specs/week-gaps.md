# Spec: The week at a glance, gaps in red (v0.6 candidate)

Status: draft, waiting for the user's approval (2026-10-30). No expert fan-out yet: written from the code; the fan-out runs once the user picks this feature. `SECURITY NOT TRIGGERED`: no new input, sign-in, data or dependency.

## Context and observed problem

- Section 5 of `docs/input/01-product-ux-spec.md` ("Smart Gap Analysis"): a live picture of how the shifts are staffed, with clear red alerts for a constraint conflict or a missing worker with the needed role. Not built.
- Today the calendar card (`src/pages/Calendar.tsx`) only says "עוד אין עובדים במשמרת" when the crew is empty, and outlines a shift in orange when a constraint blocks a crew member. A shift that needs 3 people and has 2, or has a worker without the needed certification, looks fine.
- The planner already knows why a place is empty (`autoAssign` in `src/lib/planner.ts` returns `unfilled` and `why`), but that is shown only inside the editor, right after pressing "שבץ".

## Target user and decision

The manager, on the phone, deciding "is this week covered, and what do I fix first?"

## Outcome

One look at the top of the week tells the manager how many shifts still need something, and one tap takes them to each one.

## Goal

- A status line at the top of the week: "השבוע: 3 משמרות חסרות · 2 התנגשויות · הכול מאויש" style counts.
- Every open shift card shows its state: covered, missing (red, with what is missing), conflict (orange, as today).
- Tapping a count shows only the shifts in that state.

## Non-goals

- Changing who is picked (that is "שבץ", and the whole-week planner in `docs/specs/week-planner.md`).
- Alerts outside the app (push, WhatsApp).
- Hours, overtime, pay.

## Assumptions

- A shift's needs are its `staffing` read through `staffingFor` (a shift with no staffing needs one "כללי").
- Closed night jobs (`closure` set) are history and are not checked.
- Past days of the shown week are checked too, but listed after today's and later ones. (Open decision 2.)

## Proposed experience

1. Calendar, under the week switcher: a status bar with up to four chips, each with a count, only when the count is above 0:
   - red "חסרים עובדים" (shifts with an empty place),
   - orange "התנגשות אילוץ" (as today's orange outline),
   - amber "אותו עובד פעמיים" (a worker in two shifts that run at the same time),
   - amber "מעל 2 לילות" (a worker over the weekly night limit, a warning only, as in the planner).
   When all counts are 0 and the week has shifts: a green "כל המשמרות מאוישות".
2. Tapping a chip filters the week to the shifts in that state; a "הצג הכול" chip clears it.
3. A red card lists what is missing, one line per empty place: "חסר: טפסן (אנטנה עד 40מ')", and the planner's reason when it has one: "אין עובד עם התפקיד וההסמכה האלה" / "לא זמינים: ...".
4. A covered card gets a small green "מאויש" badge. Colors are never the only signal: every state has words.
5. Day headers show a small red dot with a count when that day has a missing shift, so a long week can be scanned.

## System and data implications

- No new Drive files and no new saved fields. Everything is computed from `shifts`, `workers`, `shiftDefinitions`, `roles`, `certifications`, which the calendar already loads.
- One new pure rule: "which places of this shift are filled by its crew". It must match the planner's own matching (a crew member fills a place only with that role and certification), so a shift the planner fully staffed is never shown as missing.
- Performance: the check runs over one week only (tens of shifts); no measurable cost on INP.

## Acceptance criteria

1. A shift needing 2 טפסן and holding 1 טפסן shows red "חסר: טפסן" and counts once in "חסרים עובדים".
2. A shift needing "טפסן (אנטנה עד 40מ')" whose crew member is a טפסן without that certification shows that place as missing.
3. A shift fully staffed by "שבץ" never shows red.
4. A worker in a night job on Monday and a day shift on Tuesday is counted in "אותו עובד פעמיים" (the night job runs until 16:00 Tuesday).
5. A worker with a third night job this week is counted in "מעל 2 לילות", and the shift is not red for it.
6. A closed night job is never counted.
7. A week with no shifts shows no status bar, only today's empty state.
8. Every chip and badge has text; a screen reader reads the counts.
9. Moving a shift (drag or "העברה ליום אחר") or editing a worker's constraints updates the counts without a reload.

## States

- Loading / Drive error: as today (the whole calendar waits for the lists).
- Empty week: no status bar.
- Partial data (a role or certification was deleted): `staffingFor` falls back to "כללי"; the place is checked against "כללי".

## Accessibility, privacy, operations

- Touch targets at least 44px; chips are buttons with `aria-pressed`.
- Red and orange pass contrast on the dark cards (check with the `design-expert`).
- No new data leaves the browser.

## Verification

- Unit tests for the matching rule and the counts (each criterion above).
- Browser check with mocked Drive on a phone width: a week with each state.

## Open decisions

1. Should the night-limit warning appear in the status bar, or only inside the editor as today? Recommendation: in the bar, amber, since it is already a rule.
2. Past days of the week: check them, or skip them? Recommendation: check them, because a past day with a missing worker is still a fact the manager should see.
3. Should a red shift also block "שליחת סידור השבוע בוואטסאפ" or warn before sending? Recommendation: warn, not block.
