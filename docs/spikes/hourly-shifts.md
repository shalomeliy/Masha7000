# Spike: hourly shifts in "שבץ" (smart onboarding, stage 2)

Date: 2026-11-24. Code: `spikes/hourly-shifts/` (throwaway). Spec: `docs/specs/smart-onboarding.md`, question 3/3א and "משמרות לפי שעות".

## Riskiest assumption

"שבץ" can decide a worker is busy by hours (morning + evening on the same day, a night that crosses midnight,
urgent jobs, rest between shifts) with one check, and the owner's team and Dolik see no change at all.

## What was tried

`hourBusyWith`: each shift becomes a time range [start, end). A type whose end is not after its start ends the
next day (23:00-07:00). Busy = the ranges overlap, or the gap is shorter than the rest hours. 14 cases, all green.

## Findings

1. **The hour check cannot simply replace today's check.** Two of today's rules are not about hours:
   - a day job the morning after a night job (night ends 16:00) is allowed today (hotel, owner's rule 2026-11-09);
     by hours it overlaps;
   - a day job 07-16 and an urgent job opened at 20:00 the same day count as busy today; by hours they do not.
   So the hour check runs only for a team that chose hourly shifts. Every other team runs the code in use today,
   unchanged (a switch, like `featureRules.certs`).
2. Crossing midnight, touching shifts (07-15 then 15-23) and urgent jobs all work with the same range check.
3. Rest between shifts is one number: with 8 hours, morning 07-15 then evening 15-23 is refused, night 23-07 then
   the next night is fine. Needs the owner's default (see below).
4. Everything else that asks "is he busy" (ShiftEditor, MoveSheet, Calendar drag, Shali, move advice, pinned
   workers' dates) already goes through `busyWith` in `src/lib/planner.ts`, so one switch there covers them.
   Constraints are the second place: `blockingConstraints` in `src/lib/constraints.ts` must check the
   morning/noon/evening part against the shift's hours.

## Verdict: GO

With the switch: hourly teams get the hour check, old teams the old one. Open questions for the owner:
rest hours default, and whether a customer may mix hourly shifts with "לילה עד מחר 16:00".
