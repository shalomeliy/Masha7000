# Spec: Daily standby crew of 3 (v0.6 candidate)

Status: draft, waiting for the user's approval (2026-10-30). No expert fan-out yet. `SECURITY NOT TRIGGERED`.

## Context and observed problem

- Section 3 of `docs/input/01-product-ux-spec.md`: every day must have a standby shift ("כוננות") of exactly 3 people waiting at home for a call.
- Today a shift type can be marked "כוננות" in Settings (`isStandby`, `src/pages/workers/ShiftsSection.tsx`), with a headcount of 3. Nothing else reads it: no day is required to have one, nothing warns when it is missing, and the planner treats it like any shift.
- Important: the work pattern the user described later (2026-10-28) has only day shifts and night jobs, and does not mention standby. It is not known whether the team really runs a daily standby today. This must be answered first (open decision 1).

## Target user and decision

The manager, deciding each week who is on call each day.

## Outcome

Every day of the week has its 3 on-call people, and a day without them is impossible to miss.

## Goal

- A Settings switch "כוננות יומית חובה" (off by default, so nothing changes for a team without standby).
- When on: every day in the calendar shows a standby card at the top of the day, saved or not yet.
- A day without a full standby crew is red in the week status (see `docs/specs/week-gaps.md`).
- "שבץ" fills standby like any shift, with its own fairness count.

## Non-goals

- Calling a standby worker out from the app, or tracking call-outs. (Possible later: "הוקפץ" on a standby card that opens an urgent shift with that worker.)
- Standby pay.

## Assumptions (each to confirm)

- One standby crew per calendar day, 3 people, role "כללי" unless the manager changes the staffing on the standby shift type.
- Standby runs the same hours as the day it belongs to (00:00 to 24:00). (Open decision 2.)
- A worker may be on standby and in a day shift on the same day. (Open decision 3.)
- Standby does not count toward the 2-nights weekly limit, and is counted apart from working shifts for fairness.

## Proposed experience

1. Settings > סוגי משמרות: the standby type gets the switch "חובה בכל יום". Only one type can have it.
2. Calendar: each day starts with a violet "כוננות" card: "3 בכוננות: א, ב, ג" or "כוננות: חסרים 2". Tapping it opens the usual shift editor with the standby type already set, date fixed.
3. A day without a saved standby shift shows the card as a dashed placeholder "אין עדיין כוננות" with a "שבץ כוננות" button, which creates the shift and runs "שבץ" in one step.
4. The week status bar counts days with missing standby: "כוננות חסרה ב-3 ימים".
5. WhatsApp day and week texts list the standby crew under its own line.

## System and data implications

- Standby shifts are ordinary `ShiftRecord`s with the standby `shiftDefinitionId`. No new Drive file.
- `ShiftDefinition` gets one optional field (required every day). Old files read as "not required".
- Planner: a new soft rule, fewest standby days this week and lately, applied only to standby places; working shifts ignore standby when ranking (or not, per open decision 3).
- Constraints: a worker's day-off blocks standby on that day; a "no nights" constraint does not.

## Acceptance criteria

1. With the switch off, the calendar looks exactly as today.
2. With it on, a week of 7 days with no standby shows 7 dashed standby cards and "כוננות חסרה ב-7 ימים".
3. "שבץ כוננות" on a day saves a standby shift with 3 crew members who are not blocked that day.
4. A standby shift with 2 people shows "כוננות: חסר 1" and counts as missing.
5. Over a 4-week run of "שבץ", no worker gets more than 2 standby days above the least-loaded fitting worker (fairness), when enough workers fit.
6. Turning the switch off hides the placeholders but keeps every saved standby shift.

## States

- Loading/error: as today.
- No workers or fewer than 3 fitting workers: the planner fills what it can and the card says why (same reasons as today).

## Verification

Unit tests for the daily requirement and the standby fairness rule; browser check of a week with mixed standby states.

## Open decisions (the user's)

1. Does the team actually have a daily standby of 3 today? If not, drop this spec. This is the first question.
2. When does standby start and end (for example 16:00 to 07:00 the next day, or the whole day)? It decides overlap with day shifts and night jobs.
3. Can a worker be on standby and in a day shift the same day? In a night job?
4. Is standby needed on Friday and Saturday too?
