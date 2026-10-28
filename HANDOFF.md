# Handoff

## Done: v0.1 (2026-10-28)

- App skeleton: Vite + React + TS + Tailwind v4, RTL Hebrew, dark, mobile-first, bottom nav (יומן, עובדים, ארכיון, הגדרות). Only Settings is real; the other tabs are placeholders.
- Data types from the spec: `src/types/models.ts`.
- Google infrastructure: `src/lib/google/` (auth, drive, calendar). See `docs/spikes/google-connection.md` for decisions.
- Settings screen has a "בדיקת חיבור לגוגל" button that runs the full Drive + Calendar round trip.
- `npm run verify` passes (lint, tests (none yet), typecheck, build).

## Google spike: GO (2026-10-28)

Google Cloud project `masha7000`: Drive API + Calendar API enabled, consent screen "SmartShift" (External, user is a test user), Web client with origin `http://localhost:5180`. Client ID is in `.env.local` (not committed). The live connection check passed 5/5.

When deploying to Vercel: add the Vercel URL to the client's Authorized JavaScript origins, and set `VITE_GOOGLE_CLIENT_ID` in Vercel env vars. Remind the user.

## Done: v0.2 workers, roles, shift types (2026-10-28)

- Spec: `docs/specs/workers-roles-shifts.md` (short spec, no expert fan-out; no spike needed, every part already proven in v0.1).
- "עובדים" tab is real: three sections (עובדים / תפקידים / משמרות), card lists, bottom-sheet editor (`src/components/Sheet.tsx`, native `<dialog>`), two-step delete.
- Pure rules in `src/lib/catalog.ts` (validation, cascade role delete, overnight shifts, Hebrew counts), 11 Vitest tests.
- Drive persistence: `src/lib/data/useDriveList.ts` (TanStack Query, whole-list optimistic writes, rollback, saves to one file serialized via mutation scope). Files: `roles_definition.json`, `workers.json`, `shift_definitions.json`.
- Starter buttons on empty lists: roles (אחראי משמרת, מוקדן, טכנאי) and shifts (בוקר 07-15, ערב 15-23, לילה 23-07, כוננות 24h x3). Nothing is written until pressed.
- `Worker` gained optional `phone`, `notes`. Worker names may repeat; role and shift names may not.
- Verified in the browser with a mocked Drive (fetch + GIS stubbed from the console): add, edit, duplicate name, cascade delete, failed save rollback, sheet locked during a slow save. change-reviewer findings (concurrent saves, duplicate file creation, standby headcount, zero-count wording) fixed.

### v0.2 revision after user feedback (same day)

Real org data replaced the generic examples (see the "Update from the user" section of the spec and project memory `org-domain`): day + night-to-next-afternoon starter shifts, the user's roles, a new certifications list (`certifications.json`, shared `TagSection` with roles), full worker profile, and a role/certification filter on the workers list (`filterWorkers`, AND semantics). `normalizeWorker` / `normalizeShift` upgrade older Drive files on read. 18 tests.

Browser-console testing tip: after HMR the app loads `/src/store/auth.ts?t=...`; import that exact URL (from `performance.getEntriesByType('resource')`) to reach the app's store, not the bare path.

## Done: v0.3 shifts, closing night jobs, urgent shift (2026-10-28)

- Spec: `docs/specs/shifts-closing-urgent.md`. Spike: `docs/spikes/hebrew-dictation.md` (GO with fallback; real speech not yet heard on the user's phone, needs the Vercel deploy).
- User decisions: closing only for night jobs (type with `endsNextDay`, or urgent); partial/postponed go to "לשיבוץ" automatically; urgent shift ends next day 16:00 unless edited, can be cancelled (deleted) or fully edited; week is Sunday to Saturday.
- "יומן" tab is real (`src/pages/Calendar.tsx`): week view with prev/next, "משמרת דחופה עכשיו", "משמרת חדשה", shift cards, close-job bar on night shifts. Editor `src/pages/calendar/ShiftEditor.tsx` (crew picker shows each worker's shift count this week, urgent included). Closing `src/pages/calendar/CloseJob.tsx`.
- New bottom tab "לשיבוץ" (`src/pages/ToSchedule.tsx`): waiting jobs (schedule into a shift, edit, delete, add by hand) and the postpone reasons list.
- Drive files: `shifts.json` (`ShiftRecord[]`), `pending_jobs.json`, `postpone_reasons.json`. Pure rules in `src/lib/shifts.ts` (19 tests).
- Shared components: `DateField` (calendar on tap, typed dates checked; every date must use it, user rule), `DictationField` (he-IL mic button where supported).
- Tap-to-call: `telHref` + dial links on worker card and each phone field.
- Scheduled jobs stay in `pending_jobs.json` with `scheduledShiftId` (see `isWaiting`, `pendingAfterShiftSave`), so retries and cancels never lose or duplicate a job. change-reviewer REPAIR findings fixed, 25 shift tests.
- Pencil mark on every list card (edit; delete inside), user request.
- Verified in the browser with an in-memory Drive mock (incl. forced failure of the second Drive write): urgent shift, postpone with note, waiting job created, starter reasons, scheduling the job removes it.

## Next

Hours: regular shifts still have no hours (fixed 07:00/16:00). Only urgent shifts carry start/end time.

Not built yet: the automatic weekly planner and gap analysis. It must read `shifts.json` and count urgent shifts (use `weekShiftCount`). Writing shifts to Google Calendar is also not built.
Next feature candidate: worker constraints (text + voice), or the weekly planner. Ask the user which.
