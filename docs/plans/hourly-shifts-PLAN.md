# Plan: smart onboarding, stage 2 (shift types with hours)

Spec: `docs/specs/smart-onboarding.md` (questions 3/3א, "משמרות לפי שעות"). Spike: `docs/spikes/hourly-shifts.md` (GO).
Status: waiting for the owner's approval.

## Rule above all

A team that did not choose hourly shifts (the owner, Dolik, every team from before) runs today's code, unchanged.
The switch is `settings.shiftHours` in the team's `settings.json`; absent = off.

## Steps (each ends green on `npm run verify`)

1. **Data.** `AppSettings.shiftHours?: { on: true; restHours: number }`. `featureRules.hours` / `restHours`
   set from it in the app (same way as `applyFeatureRules`). `ShiftDefinition` unchanged: it already has
   start and end; end not after start = ends next day.
2. **Busy check.** `busyWith` in `src/lib/planner.ts`: with `featureRules.hours`, the range check from the spike
   (overlap or less than `restHours` apart); a "night until 16:00 tomorrow" type keeps its next-morning day-job
   exception. Off: today's code. Tests: the spike cases + every existing planner test unchanged.
3. **Constraints.** `blockingConstraints`: with hours on, morning = until 12:00, noon = 12:00-17:00, evening =
   from 17:00, checked against the shift's hours on each of its days. Off: unchanged.
4. **Wizard.** Question 3 becomes multi-pick: בוקר / צהריים / ערב / לילה / יום מלא (עד 16:00) / לילה עד מחר
   16:00. Question 3א: start and end for each picked hourly one, prefilled (07-15, 12-20, 15-23, 23-07).
   Picking only the last two = today's model, hours stay off. Saves the shift types list + `shiftHours`.
5. **Settings.** "תבניות עבודה" (`src/pages/workers/ShiftsSection.tsx`): with hours on, each type shows start
   and end fields; a switch "משמרות לפי שעות" and rest hours. Turning it off hides hours only.
6. **Calendar.** A day's jobs sorted by start time; with hours on, each card shows "15:00-23:00". Off: unchanged.
7. **Shali (free).** Words "בוקר", "צהריים", "ערב", "משמרת ערב" pick the team's type with that name
   (`src/lib/freeCommands.ts`); the assistant prompt gets the types with hours. Tests on the stand-in only.
8. **Guide, translations, e2e.** `src/lib/guide.ts` chapter, all strings in 15 languages, Playwright: a new team
   picks morning + evening, "שבץ" puts one worker in both only when rest allows; the owner's team unchanged.

## Not in this stage

Closing an evening job (only night types close, as today). The "2 nights a week" rule stays on types that end the
next day.

## Risks

Missing a spot that thinks in whole days: `shiftDays` users (worker agenda, Shali texts) keep days, which is still
right for showing a date; only busy and constraint checks need hours.
