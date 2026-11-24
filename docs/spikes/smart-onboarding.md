# Spike: turning features on and off (smart onboarding)

Date: 2026-11-24. Spec: `docs/specs/smart-onboarding.md` (approved by the user 2026-11-24).
Code: `spikes/smart-onboarding/flags.spike.test.ts` (throwaway).

## Questions
1. Does a small catalog with dependencies resolve to a consistent set? Success: `certExpiry` is off whenever `certs` is off.
2. Can "certs off" be done at one choke point without touching the solver? Success: "שבץ" picks a worker without the certification when staffing is read through `staffingFor(staffing, [])`.
3. Do existing managers (no onboarding record) keep everything? Success: all on.

## Run
`npx vitest run spikes/smart-onboarding/ --reporter=verbose --silent=false`

Actual output:
```
A2 on: [] 1 | off: [ { workerId: 'noCert' } ] 0
✓ A1: a dependency turns off with its parent
✓ A2: certs on -> the place stays empty; certs off -> the worker without the cert is picked
✓ A3: a manager without onboarding sees everything
```

## Where each feature lives (counted with grep, product code, tests excluded)
- Certifications: 44 files mention them, but the assignment logic reads them only through `slotCerts` / `staffingFor` / `fitsSlot` (`src/lib/catalog.ts`, `src/lib/planner.ts`). Passing an empty list of known certifications to `staffingFor` turns them off for "שבץ", gaps and move advice with no solver change. The UI still needs hiding in about 8 places: Settings entry, StaffingField, WorkKindsSection, WorkersSection (chips and "+ הוסף הסמכה"), CertStars, JoinForm/JoinSection, worker search.
- Vehicles: Settings entry (`src/pages/Settings.tsx` panel `vehicles`), `VehiclePick` in ShiftEditor, vehicle text in Calendar/ToSchedule, 61 lines in `src/lib/freeCommands.ts`, 5 in `api/_lib/assistant.ts`.

## Verdict: GO
The logic side is cheap (one choke point per feature). The cost is the UI and Shali:
- One `useFeature(id)` hook read from Drive settings; every screen asks it. No data is deleted.
- Shali: free commands must check the flag where an intent is chosen (one check per intent family), and the server prompt must leave out disabled features, or Shali will offer a vehicle that the manager cannot see.
- Hide, never delete; existing data on a hidden feature stays and returns when turned back on.
- Hourly shifts are a separate stage with its own spike (overlap check in "שבץ").
