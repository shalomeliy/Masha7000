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
- Partial close: reopen the same task, or close and open a linked follow-up task (endless chain, `taskHistory`, shown in "לשיבוץ").
- Pencil mark on every list card (edit; delete inside), user request.
- Verified in the browser with an in-memory Drive mock (incl. forced failure of the second Drive write): urgent shift, postpone with note, waiting job created, starter reasons, scheduling the job removes it.

## Done: staffing requirement on every job (2026-10-28)

- User request: every shift and every waiting job says how many people it needs, and for each person a required role (default "כללי") and an optional certification. This is the input for the automatic planner.
- Model: `StaffSlot { roleId, certificationId? }`, `staffing: StaffSlot[]` on `ShiftRecord` and `PendingJob` (normalized to `[]` on read; `staffingFor` turns empty into one "כללי" slot and maps deleted roles to "כללי", drops deleted certs). The planner must read staffing through `staffingFor`.
- Flow: a waiting job's staffing goes into the shift it is scheduled to (`blankShift`); a partial/postponed night job takes its shift's staffing to "לשיבוץ" (`applyClosure`, keeps an already edited job's staffing).
- UI: shared `src/pages/calendar/StaffingField.tsx` (count stepper 1..20, role + cert per person) in the shift editor and the job editor; job cards show "צריך 2 אנשים: טפסן (גובה 40), כללי"; the shift editor shows "עובדים במשמרת (1 מתוך 2)". The calendar shift card does not show staffing yet.
- Role "כללי": always in the roles list (`withGeneralRole` on read, id `general`, or the existing role named כללי from older files, found by name via `generalRoleId`). Every worker holds it implicitly (`workerHasRole`, `filterWorkers`, crew role options, `shiftRecordError`); it cannot be renamed or deleted, and the worker editor no longer offers it as a chip. Crew saved with an empty role become "כללי" when the shift is edited.
- Not done: shift types' old `requiredHeadcount` / `requiredRoleIds` are not used to prefill staffing.
- Verified in the browser with the in-memory Drive mock: old job shows "אדם אחד: כללי", edited to 2 people (טפסן + 40m, כללי) and saved to Drive, scheduling carries it into the shift, a worker with no roles is added as "כללי". 58 tests.

## Done: tap-to-call everywhere (2026-10-28)

- Every phone field in the worker editor always shows a call button (grey until a number is typed).
- Workers on a calendar shift card and in the shift editor's crew list are tap-to-dial (`WorkerDial` in `src/pages/workers/common.tsx`, mobile number). On the card the crew row sits outside the edit button, so a name tap dials and the rest of the card still opens the editor.
- `.claude/launch.json` has `shiftsmart-alt` on port 5181 for when 5180 is taken by another session.

## Next

Hours: regular shifts still have no hours (fixed 07:00/16:00). Only urgent shifts carry start/end time.

Not built yet: the automatic weekly planner and gap analysis. It must read `shifts.json` and count urgent shifts (use `weekShiftCount`). Writing shifts to Google Calendar is also not built.
Next feature candidate: worker constraints (text + voice), or the weekly planner. Ask the user which.

Next version is still the user's choice: worker constraints (text + voice) or the automatic weekly planner. Ask before starting either.

## Done: automatic crew for a shift, "שבץ" (2026-10-28)

- User request: the manager defines only the staffing (count + role + cert per place); a "שבץ" button under the crew list picks the workers. No spike: a pure function in an already-proven screen.
- Rules in `src/lib/planner.ts` (pure, deterministic, 13 tests in `planner.test.ts`):
  - Hard: one worker per place; a place gets only a worker with its role (everyone holds "כללי") and its certification. Augmenting-path matching, so a place only one worker can fill is never lost to an easier place.
  - Soft, in order: not already in another shift on the same days (a night job runs into the next day, urgent until its end date), under `NIGHT_LIMIT` = 2 night jobs per Sunday-Saturday week (urgent counts as night), fewest shifts this week (urgent included), fewest nights this week, fewest shifts in the past 4 weeks, then Hebrew name, then id.
  - Over the night limit or busy: still placed when nobody else fits, with a warning ("כבר שובץ ל-2 לילות השבוע" / "כבר במשמרת אחרת באותו זמן") on the crew row and in the pickers.
  - Workers already in the crew stay (in a place of their role if possible); only empty places are filled. Places with no fitting worker are listed under the button.
- Shift editor (`ShiftEditor.tsx`): the manager does not pick workers up front (user rule): with an empty crew only a hint and the "שבץ" button show; the add-worker list appears only after a crew exists. Then "שבץ את המקומות החסרים", a swap button per crew row (offers only free workers holding that row's role, fairest first), add-worker list sorted by the same fairness order with the warnings.
- Verified in the browser with the in-memory Drive mock: night shift with 3 places (טפסן + גובה 40, טפסן, כללי) got the only certified worker with the night warning, the least-loaded climber and general worker; swap offered only the other climber; saved crew matched in `shifts.json`.
- Not done: worker constraints (dates off) are not read yet, since that feature does not exist; the weekly planner over many shifts at once and gap analysis are still open.

## Done: smoother Google sign-in (2026-10-28)

- Cause of "sign in again after every update/reload": the access token lived only in memory, and the first request of every page load used `prompt: 'consent'`.
- Now (`src/lib/google/auth.ts`): the token and its expiry are saved in localStorage (`shiftsmart.token`), so a reload within the hour skips the sign-in screen. The account is remembered (`shiftsmart.account`, email from Drive `about` best effort), so renewal uses `prompt: ''` + `login_hint`: one click, no consent screen, popup closes itself. Sign-out clears both.
- Limit (serverless): tokens last ~1 hour, and GIS opens a popup that browsers allow only from a click, so renewal can't be fully silent in the background. Fully silent long-term sign-in needs a backend holding a refresh token.
- User decision (2026-10-28): no server for now. **When the app is deployed to Vercel, tell the user it is time to revisit a small backend for long-term silent sign-in** (refresh token; note Google "Testing" status expires refresh tokens after 7 days).

## Done: Vercel deploy + installable app (2026-10-28)

- PWA: `public/manifest.webmanifest` (RTL Hebrew, standalone), icons in `public/icons/` (calendar mark, sky + amber on slate-950, made with a throwaway PIL script; maskable variant inside the safe zone), `public/sw.js` (navigation network-first with cached `/` offline fallback, `/assets` + `/icons` cache-first, other origins untouched). Registered in `src/main.tsx` only in production builds. The Vite default favicon/icons.svg were removed.
- `vercel.json`: Vite framework, SPA rewrite, `sw.js` no-cache, `/assets` immutable.
- `.claude/launch.json` gained `shiftsmart-built` (vite preview on 4180) to test the built app; checked there: worker active, manifest and all icons served.
- Deploy path: Vercel project imported from GitHub `shalomeliy/Masha7000` (auto-deploy on push to `master`), env var `VITE_GOOGLE_CLIENT_ID` set in Vercel (build-time, Vite inlines it). The user signs in to Vercel themselves. After the first deploy, the Vercel URL must be added to Authorized JavaScript origins of the OAuth client in Google Cloud project `masha7000`.
- After deploy: remind the user to revisit a small backend for long-lived silent Google sign-in (see "smoother Google sign-in").
- Live: **https://masha7000.vercel.app** (Vercel team "Delvr", Hobby, project `masha7000`, auto-deploys every push to `master`). Checked: site serves, client ID inlined in the bundle, `sw.js` no-cache. The user added the URL to the OAuth client's JS origins; Google sign-in on the live site works (user confirmed).
- Not yet confirmed by the user: install on the phone, Hebrew dictation on the phone.
