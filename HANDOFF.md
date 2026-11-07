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

## Done: WhatsApp export of a day and a week (2026-10-28)

- User request: send the shifts of a chosen day, and a weekly report (Sunday to Saturday), as Hebrew WhatsApp text: date, each shift's place, job, workers and their roles.
- No spike: text building is pure, and sending uses standard browser features (wa.me link, Web Share, clipboard).
- `src/lib/report.ts` (pure, 5 tests): `dayReport`, `weekReport`, `whatsappHref`. WhatsApp bold with `*...*`; urgent shifts show start and end; empty crew says "עוד לא שובצו"; empty days say "אין משמרות".
- Calendar: "שליחת היום" on each day header that has shifts, "שליחת סידור השבוע בוואטסאפ" under the week bar (sends the week on screen, so the manager moves to next week first for the coming week). Both open `src/pages/calendar/ShareSheet.tsx`: text preview, "שליחה בוואטסאפ" (wa.me, pick the chat/group in WhatsApp), "שיתוף" (phone share sheet, only where supported), "העתקה".
- Verified in the browser with the in-memory Drive mock (fetch + GIS stubbed): day and week text correct, wa.me link encoded. Not yet tried on the user's phone.

### WhatsApp export, revision after user feedback (same day)

- User: the text looked plain; wanted it designed, or sent as a picture.
- Both: `report.ts` now builds structured data (`dayData`, `weekData`) and `reportText` formats it with WhatsApp bold/italic and icons per shift kind. `src/lib/reportImage.ts` draws the same data as a 1080px PNG card on a canvas (dark header, white card per shift with a color strip per kind, worker rows with role labels), measured then drawn.
- Share sheet: image preview, "שליחה כתמונה" (Web Share with a file, so the phone's share sheet opens and WhatsApp is picked there; download on a computer without file sharing), "שליחה כטקסט" (wa.me), "העתקת טקסט". The PNG is drawn when the sheet opens, because the share call must come straight from the tap.
- Bidi: a date range must have a Hebrew word between the dates ("1.11 עד 7.11.2026"); "1.11 - 7.11" shows reversed in a right-to-left line.
- Verified in the browser with the mock: image looks right for day and week. Image sharing on the user's phone not yet confirmed.

## Done: worker constraints + WhatsApp constraints request (2026-10-28)

- Coordinator brief: the agreed next step. No spike: pure rules plus screens built from parts already proven (DateField, DictationField, wa.me sharing).
- Model: `Constraint { when: 'dates' | 'weekdays' | 'always', from/to, weekdays (0 = Sunday), nightsOnly, note }`. The spec's `{ date, reason }` is upgraded on read (`normalizeConstraint`, called from `normalizeWorker`). `always` is always nights only ("בלי לילות בכלל").
- Rules in `src/lib/constraints.ts` (pure, tests in `constraints.test.ts`): `blockingConstraint` (a whole-day constraint blocks a shift on any day it runs, so a night job is blocked by a day off on its second day; nights-only blocks a night job starting on that day), `constraintText`, `constraintError`, `isOver`, `shiftDays`.
- Planner: a blocked worker is never picked by "שבץ" (hard rule). A worker the manager placed by hand stays, with a red warning. `Plan.why` explains each empty place: who is unavailable and why, "כל המתאימים כבר במשמרת הזו", or no worker with the role/cert. Blocked workers sort last in the pickers with their constraint shown.
- Calendar card: a crew member a constraint now blocks shows in red (constraint added after the crew was picked).
- Worker editor: "אילוצים" section (`src/pages/workers/ConstraintsField.tsx`): add/edit/delete inline, dates / weekly days / always, whole day or nights only, free-text detail with dictation; past ranges dimmed. Worker cards show active constraints as amber chips.
- WhatsApp request (user request): "בקשת אילוצים מהעובדים בוואטסאפ" on the workers list (`RequestSheet.tsx`, `requestText`): header with the week's dates (default next week), one line per day for "אין אילוץ" or details, a notes line. The worker's reply is pasted into "הדבקת תשובה מוואטסאפ" in that worker's editor (`parseReply`): each day with text becomes a one-day constraint (nights only if it mentions לילה/לילות), the notes line is added to the worker's notes. Header lost: the manager picks the week.
- JS regex `\b` does not see Hebrew letters as word letters; the day-name match uses a lookahead.
- Verified in the browser with the in-memory Drive mock: old constraint upgraded, request text and wa.me link, pasted reply gave 2 constraints + notes, weekly nights-only added, saved to `workers.json`, "שבץ" skipped the vacationing and the busy-with-a-wedding workers and listed why, calendar card warned about a blocked crew member.
- Not done: free text is not parsed into dates except in the reply format; a constraint does not stop a manual save.

### Constraints by part of the day (2026-10-29)

- User request: read the worker's WhatsApp words as morning / noon / evening / whole day. User rules: לימודים, חופש = whole day; אירוע = evening unless it says בוקר or צהריים.
- Model: `Constraint.part?: 'morning' | 'noon' | 'evening'` (absent = whole day), `guess?: true` (words not understood). `nightsOnly` kept as is ("בלי לילה").
- `readAnswer` in `src/lib/constraints.ts`: Hebrew word table, no server. Order: explicit time word (בוקר / צהריים / אחה"צ / ערב) wins; two time words or "כל היום" = whole day; לילה alone (no event) = nights only; whole-day words (לימודים, חופש, מילואים, מחלה, חו"ל, ...); an hour ("ב-10", "בשעה 14:30", "עד 12") gives its part (<12 morning, <17 noon, else evening; a date with a dot is not an hour); events (אירוע, חתונה, בר מצווה, ...) = evening; "לא יכול", רופא, טיפול = whole day; nothing known = whole day marked as a guess. `readingText` gives the preview line ("ערב · חתונה"), with the worker's whole word as the cause.
- `blockingConstraint`: whole day / morning / noon block every day a shift runs on. Evening blocks a day the shift runs past, not its last day (day shift ends 16:00; a night job ends 16:00 the next day), unless an urgent shift ends at 17:00 or later.
- Worker editor: part pills (כל היום, בוקר, צהריים, ערב, רק בלי לילה); a guess shows in red until the manager saves the constraint. Paste preview: one row per day with what was understood, the worker's words, and a list to fix the part before adding.
- Tests: `readAnswer.test.ts` and `constraints.test.ts` (about 45 real replies plus day/night shift rules).
- Not checked in the browser this time: the dev server could not start (5 servers of other chats already running in this folder). Verified by `npm run verify` only.

### Weekly constraint with a last date, more words (2026-10-29)

- User request: a weekly constraint until a date ("לימודים כל שבוע עד xx.xx.xx"), and more words in the list.
- `Constraint.to` now also applies to `when: 'weekdays'`: optional last date. Blocks that weekday only up to it; `isOver` after it; text "לא זמין ביום שני עד 16.11". Editor: "עד תאריך (לא חובה, ריק = כל שבוע בלי סוף)" under the weekday pills.
- WhatsApp: a day answer with "כל שבוע" / "קבוע" / "שבועי" / "כל יום שני" becomes a weekly constraint on that weekday; "עד 15.2" / "עד 15.2.27" / "עד 15.2.2027" sets the last date (no year: the next such date). The request text now has an example line for it. The preview shows "כל יום שני עד 15.2".
- Words added: morning (לפנה"צ, "לפני/עד הצהריים", ברית), noon (איסוף, אוסף את), whole day (השתלמות, הכשרה, ניתוח, אשפוז, בית חולים, לידה, טיול, נסיעה, כנס, שומר שבת, חג), evening (שבע ברכות, אזכרה, אסיפת הורים, חוג, אימון), can't (לא פנוי, עסוק, תפוס).
- User edit (same day): removed שומר שבת, לא פנוי, עסוק; added חול, ערב חג (not read as evening), איסרו חג. חו"ל and חג were already there.
- Browser not checked again (5 dev servers of other chats in this folder); `npm run verify` green, 156 tests.

### A corrected WhatsApp reply replaces the earlier one (2026-10-29)

- User approved: pasting a new reply for a week replaces what the earlier paste of that week added.
- `Constraint.reply` = the Sunday of the reply's week (from the header, or the week the manager picked). `mergeReply` / `replacedByReply` in `constraints.ts`; constraints added by hand and other weeks' pastes stay. The paste preview says how many constraints the new reply will replace.
- Constraints pasted before this change have no `reply` tag, so a re-paste of those weeks does not replace them (delete by hand once).

### A later reply ends an earlier weekly constraint (2026-10-29)

- User request: a worker who stopped studying mid-term sends a new reply; the weekly constraint must stop from then on.
- Pasted weekly constraints now carry `from` (the day in the reply's week); `onDay` respects it, `normalizeConstraint` keeps it.
- `mergeReply`: a weekly constraint from an earlier reply (`reply` < this week) that still runs into this week ends the day before this week (`endedByReply`); dropped if it had not started yet. If it still holds, the worker writes "כל שבוע" again and a fresh one is added. Weekly constraints added by hand are not touched. The paste preview lists each one that will end and on what date.

## Done: Settings screen for every list (2026-10-29)

- Coordinator brief: find every fixed list and let the manager edit it in Settings.
- Fixed lists found in the code: 7. Starter lists for roles, certifications, shift types and postpone reasons (these were already editable, spread over "עובדים" and "לשיבוץ"), and the constraint word table (7 word groups, fixed in `constraints.ts`). Places and job descriptions were free text with no list. System values (closure outcomes, parts of the day, weekday names, the 2-nights limit, 07:00/16:00) were left in code on purpose.
- Settings (`src/pages/Settings.tsx`) now opens with "רשימות": תפקידים, הסמכות, סוגי משמרות, סיבות דחייה, מקומות, סוגי עבודה, מילים לקריאת אילוצים, each with its count. Each opens the same editor used elsewhere (`TagSection`, `ShiftsSection`, `ReasonsSection`) or a new one.
- Places and job types (`places.json`, `job_types.json`, `src/pages/settings/NameListSection.tsx`, rules in `src/lib/lists.ts`): suggestions only; a shift keeps its own text. Shown as tap-to-fill chips under the place/job fields (`src/components/Suggestions.tsx`) in the shift editor, the job editor and the follow-up task. Empty list: one button fills it from texts already written in shifts and jobs. Rename rewrites shifts and waiting jobs holding the exact old text (trim, case); delete only removes it from the list and says so.
- Constraint words (`constraint_words.json`, `src/lib/constraintWords.ts`, `src/pages/settings/WordsSection.tsx`): only the manager's changes are stored (`added` / `removed` per group), so built-in words added later still arrive. `applyWordSettings` writes them into the arrays `readAnswer` reads (`WORD_GROUPS` at the end of `constraints.ts`), from `ConstraintWords` in `App.tsx`. Tap a word to remove it, "החזרת המילים המקוריות" per group.
- Roles, certifications and reasons are referenced by id, so a rename already shows everywhere. Deleting a shift type now says how many calendar shifts use it (they stay, as a day shift).
- Verified on the live site with an in-memory Drive mock (fetch replaced in the page, fake token): list hub, places filled from shifts, rename propagated to 2 shifts and 1 job, delete warning, words add/remove saved, chips in the job editor. The other chat's commit 88298e4 included most of this work by accident; the fix-up commit has the rest.

## Done: move a shift to another day, constraint outline in orange (2026-10-29)

- Coordinator brief: move a whole shift (crew kept) to another day in the calendar; a crew member blocked by a constraint on the shift's day is outlined in orange, on the card and in the editor.
- Rules: `moveShift` / `dayGap` in `src/lib/shifts.ts` (date changes; an urgent shift's end date moves by the same days; a night job's second day comes from its type, so it keeps its 2-day span). `blockedCrew` in `src/lib/constraints.ts` (uses `blockingConstraint`, so part of day and weekly-until rules apply). Tests added.
- Calendar card: footer button "העברה ליום אחר" (beside "סגירת עבודה" on night jobs) opens `src/pages/calendar/MoveSheet.tsx`: quick day pills for the shift's week and the next, a date field for any other day, and an orange preview of who has a constraint on the new day (move is still allowed). On a computer the card can also be dragged onto a day (HTML5 drag, saves at once). Closed jobs are not moved.
- Orange: the card border and the blocked worker's chip, with the constraint lines and "לחץ על המשמרת כדי להחליף"; in the shift editor the blocked crew row is outlined orange (swap button on the row). These were red before.
- `SheetActions` gained an optional `saveLabel`.
- Browser not checked: the dev server could not start (5 dev servers of other chats in this folder). `npm run verify` green.

## Done: Archive screen (2026-10-29)

- Coordinator brief: the "ארכיון" tab (was a placeholder) holds the full history of shifts and their assignments, searchable by dates, worker and place. No spike: pure filtering over `shifts.json`, built from proven parts.
- Shifts are never pruned from `shifts.json`, so the archive is the whole history (the spec's "6 months" is the default range, not a limit).
- Rules in `src/lib/archive.ts` (tests in `archive.test.ts`): `archiveShifts` (dates, worker = in the crew or swapped out, exact place ignoring spaces/case, free text over place, work, closing note, follow-up task and worker names, every word must match; newest first), `archivePlaces`, `archiveSummary`, `taskLinks` (where a postponed/partial job went, and the shift a scheduled job came from), `rangeDates`.
- Swaps: new `ShiftRecord.swaps?: CrewSwap[]`. When a saved shift is saved again with a place's worker changed (`crewSwaps`, same index, not an add/remove/reorder), the change is appended. Shifts saved before this have no swap history.
- Screen `src/pages/Archive.tsx`: quick ranges (חודש אחרון, 3 חודשים, חצי שנה, הכול), from/to `DateField`s, worker and place selects, free-text search, a summary line (shifts, urgent, done/partial/postponed, swaps), read-only cards (date, type, outcome, crew with roles, swaps, reasons, closing note, follow-up task, links to the previous/next step), 50 at a time with "עוד". Future shifts in range are marked "עתידית". `Placeholder.tsx` removed.
- Browser not checked: the dev server could not start (5 dev servers of other chats in this folder). `npm run verify` green, 191 tests.

## Done: shared data in the owner's Drive + stay signed in for months (2026-10-30)

- Spec `docs/specs/long-lived-sign-in.md`, spike `docs/spikes/long-lived-sign-in.md` (GO on the user's real account), plan `docs/plans/long-lived-sign-in-PLAN.md`.
- User decisions: a small server in the same Vercel project; publish the OAuth app; more emails besides the owner may sign in; they all work on the owner's Drive (option 1 of 3; shared Drive folder and a new database rejected). Sign-out is per device; only the owner manages the list and can disconnect the Drive.
- Server (`api/`, Vercel functions, Web `GET`/`POST` exports, `.js` relative imports, no dependencies): `auth/start`, `auth/callback` (state + PKCE in a sealed 10-min cookie; identity sign-in `openid email`; the owner the first time is sent on to grant Drive + Calendar offline, scopes checked), `token` (owner access token for anyone signed in and allowed, cached in KV, `{stale:true}` skips the cache, `invalid_grant` = owner-disconnected), `logout`, `owner` (list/add/remove allowed emails, disconnect = revoke). `api/_lib/`: env, AES-GCM seal (`v1.` key version), cookies (`__Host-`, HttpOnly, Secure, Lax, 180 days), Upstash REST client, `guarded` (crash = JSON 500 / redirect, never "no server"). Tests `api/_lib/server.test.ts` (fake KV + fake Google). `tsconfig.api.json` typechecks `api/` in `npm run build`.
- Env (Vercel Production only): `GOOGLE_CLIENT_SECRET`, `SESSION_KEY`, `OWNER_EMAIL`, KV url/token from the Upstash integration, plus the existing `VITE_GOOGLE_CLIENT_ID`. Missing any: `/api/token` answers 503 not-configured and the app stays in popup mode (each person's own Drive), so the live site works before setup. Local dev has no `/api` (404) = popup mode.
- Client: `auth.ts` server mode vs popup mode (`resume()` at start, 10s timeout; mode remembered in `shiftsmart.mode`; access token in memory only in server mode; 401 renews once with stale; offline = `OfflineError`, not a sign-out). Store `status` (checking / signedIn / signedOut / notAllowed / ownerDisconnected / failed), "מתחבר..." screen in `App.tsx`, wording in `SignIn.tsx` (`?signin=` notices), `DriveError` per reason. Settings: "מחובר כ-", sign-out note, owner-only `AccessSection` (emails, two-tap remove, "ניתוק הדרייב").
- Edit conflicts: `drive.ts` remembers each file's Drive `version`; a write whose file moved since it was read throws `ConflictError`, the list reloads with the other person's change and a message asks to redo it.
- `sw.js` skips `/api/` (cache v2); `vercel.json` rewrite skips `api/`, `/api` no-store.
- Verified: 221 tests; browser on the built app with a fake `/api` and in-memory Drive: signed in with no click, Settings shows the account and the list, add email, conflict message with the other person's place kept. Not yet run on Vercel: needs the owner's setup (Upstash, env vars, redirect URI `https://masha7000.vercel.app/api/auth/callback`, publish the consent screen). `SESSION_KEY` was generated into `.env.local` for the owner to copy.
- After setup: check on the live site with the owner and a second email; remind the owner to check after 8 days that they are still signed in.

## Week at a glance: gaps in red (2026-10-30)

- Spec `docs/specs/week-gaps.md`. Spike skipped: pure computation on lists the calendar already loads, every part proven in this project.
- `src/lib/gaps.ts`: which places of a shift its crew leaves empty (matched like the planner: role in this shift + certification; "כללי" places take anyone), why nobody can fill one, double-booked and over-night-limit crew. Tests in `gaps.test.ts`.
- Calendar: status chips (חסרים עובדים / התנגשות אילוץ / אותו עובד פעמיים / מעל 2 לילות) that filter the week, red card with "חסר: ..." lines, amber per-worker warnings, red count on the day header, green "מאויש" only with no gap, warning on the WhatsApp week share.
- Verified in the browser with the in-memory Drive mock at phone width: counts, filter, "הצג הכול", no sideways scroll. change-reviewer agent not available in this cloud session; not run.
- 2026-10-30 later: setup done by the owner. Google needed a privacy policy link to publish (`public/privacy.html`). The project's store is Vercel Marketplace "Redis" (`REDIS_URL`, TCP), not Upstash REST, so `api/_lib/kv.ts` also speaks plain Redis via the `redis` package. `/api/token` not-configured answers list missing setting names. Owner signed in on the live site successfully. Still open: a second email signing in (user will do it later), and an 8-day check that the sign-in survived (proves "In production").

## "שבץ את השבוע" (2026-10-30)

- Spec `docs/specs/week-planner.md`. Spike skipped: reuses `autoAssign` unchanged, every part proven.
- `planShifts` / `weekPlanOrder` in `src/lib/planner.ts`: runs "שבץ" on each shift in order (date, night first, more places first), carrying each new crew into the records the next one sees. Tests in `planner.test.ts`, including equivalence with one-by-one.
- Calendar: a "שבץ את השבוע (N משמרות)" button for open shifts from today on with an empty place; `WeekPlanSheet` previews added workers (green) and places still empty with the reason (red); "שמור הכול" is one save of `shifts.json`.
- Verified in the browser with the in-memory Drive mock at phone width: preview, save wrote both shifts, status counts updated.

## No worker in two shifts at once; swaps keep the place's certification (2026-10-31)

- User rule: a worker is never in two shifts that run at the same time (a night job runs until 16:00 the next day), and a swap must bring a worker with the place's role and certification.
- `busyWith` / `busyCrew` / `busyText` in `src/lib/planner.ts`. "שבץ" and "שבץ את השבוע" now treat "already in another shift then" as a hard rule (was a soft preference) and say so when a place stays empty.
- Shift editor: busy workers are not offered in "הוספת עובד" or swap; swap offers only workers who fit the place this worker fills (`crewPlaces` in `src/lib/gaps.ts`, role + certification); save is refused with the clashing shift named.
- Moving a shift (sheet or drag) onto a day where a crew member is already in another shift is refused with the names.
- A worker with a constraint is still offered by hand, with the orange warning (manager override); "שבץ" never picks them.
- Verified in the browser with the in-memory Drive mock: swap offered nobody when the only other climber lacked the certification; move onto a clashing day refused.

## Monthly report per worker (2026-10-31)

- Spec `docs/specs/monthly-worker-report.md` (user accepted every recommended answer). Spike skipped: pure counting over lists the archive already loads, every part proven.
- `src/lib/monthReport.ts` (tests in `monthReport.test.ts`): `monthReport` counts per worker day / night (`isNightShift`, urgent = night) / urgent / weekend (Friday, Saturday by start date) / total = day + night / "הוחלף" (in a swap's `outId` and not in the final crew, not in the total). A shift counts in the month of its start date; postponed counts as worked; deleted workers show as "עובד שנמחק". In the current month, shifts after today are not counted ("עד היום"). `monthText` (WhatsApp), `monthCsv` (BOM, quotes escaped, totals row), `defaultMonth` (previous month until the 5th).
- Archive tab: switch "משמרות" / "דוח חודשי" (`src/pages/archive/MonthReport.tsx`): month arrows (no going past this month), table scrolling inside itself with a sticky name column, totals row, "שליחה בוואטסאפ", "הורדה לאקסל" (`masha7000-YYYY-MM.csv`). Tapping a worker opens the shift list filtered to that worker and month.
- Browser not checked: the dev server could not start (5 dev servers of other chats in this folder). `npm run verify` green.
- Remaining unbuilt spec: `docs/specs/backup-restore.md`.

## Done: backup and restore (2026-10-31)

Settings > "גיבוי" (`src/pages/settings/BackupSection.tsx`, logic in `src/lib/backup.ts`):
- "הורדת גיבוי": two taps (prepare, then save) so phone browsers allow the download. Every list except settings.json.
- "שחזור מגיבוי" (owner only, or anyone in popup mode): file is checked as untrusted (20 MB, app marker, version, each list's shape, text fields), preview with counts, then a "before restore" copy, then each list written with the normal conflict check. A partial failure shows what was restored and offers "נסה שוב" (the retry skips the conflict check for the remaining lists).
- Automatic copies in the appDataFolder, `backup-weekly-*.json` / `backup-beforeRestore-*.json`, counts in Drive appProperties; 8 weekly + 3 before-restore kept. Weekly copy on the first open of each week (`WeeklyCopy` in App.tsx), skipped for an empty account.
- Not done: the `security-expert` agent does not exist in this project, so no separate security review; change-reviewer's findings were fixed. Week is counted in the device's time zone. Not yet tried on a real iPhone.

## Worker ID, personal number and department (2026-11-02)

- Worker form: "ת.ז" (`idNumber`, optional, exactly 9 digits after removing spaces and dashes, `isIsraeliId`), "מספר אישי" (`personalNumber`, optional free text), "מחלקה" (`departmentId`, at most one; tapping the chosen chip clears it). The department shows as a blue chip on the worker card. Older workers simply have the three fields empty.
- Departments list: `departments.json`, Settings > "מחלקות" (`src/pages/settings/DepartmentsSection.tsx`). No file yet = `STARTER_DEPARTMENTS` (תקשורת, תרנים, רוקק, נתיבי חדירה, רובוטים, רחפנים, fixed ids). Rename by id; delete clears the department from its workers first.
- Backup: `departments` added to `BACKUP_LISTS`; a backup made before this gets the starter list instead of being rejected.
- Spike skipped: same pattern as roles and places, every part already proven. Built in a separate clone because the "לילה+" work was uncommitted in the main folder. Browser not checked (sign-in needs Google); `npm run verify` green.

## Work kinds "סוג עבודה" with staffing templates (2026-11-02)

- `WorkKind { id, name, staffing }` in `work_kinds.json`, Settings > "סוגי עבודה" (`src/pages/settings/WorkKindsSection.tsx`). The older suggestion list `jobTypes` (text for "מהות העבודה") is now titled "מהויות עבודה"; its data key and file are unchanged.
- `StaffSlot` gained `altRoleIds` (other roles that fill the place, e.g. "מנהל טיפוס" in a climber place) and `kindId` (the kind it came from). `ShiftRecord.workKindIds` holds the picked kinds. `toggleKind` (`src/lib/workKinds.ts`) adds/removes a kind's places; hand-added places stay.
- First use (no `work_kinds.json`): `useStarterWorkKinds` writes "טיפוס" (מנהל טיפוס + 2 places מטפס-or-מנהל טיפוס) and "ריתוך" (one "כללי" with cert "רתך"), creating missing roles/cert. An existing "טפסן" is used as the climber when there is no "מטפס" (user asked to confirm).
- Sharing: places of two different kinds may be filled by one worker, never two of the same kind. `autoAssign` shares before adding people and prefers new workers who can also cover other kinds; `crewCover` (gaps) counts a crew member in every place they cover; the job sheet shows "עובדים בעבודה: 3, ממלאים 4 מתוך 4 מקומות". Swap offers workers who fit all the places the outgoing worker covers, else their own place.
- Not done: kinds are not on "לשיבוץ" jobs (staffing there is still set by hand). Verified in the browser with the in-memory Drive mock (manager who welds + 2 climbers = 3 people for טיפוס+ריתוך, saved, card shows "מאויש"). `npm run verify` green.

## Faster saves: shifts kept by month (2026-11-02)

- Why: every save rewrote the whole `shifts.json` (all history, never pruned; about 1.7 KB a shift, so 2,000 shifts ~3.5 MB), and after Drive's own late version bump the conflict check downloaded the whole file again to compare.
- `src/lib/google/drive.ts`: reads and writes remember Drive's `md5Checksum`; a changed version with the same checksum is not a conflict, without downloading. No checksum from Drive: the old download-and-compare. New `listNames`, `renameFile`.
- `src/lib/data/shiftMonths.ts`: one file per month by start date (`shifts-YYYY-MM.json`). `saveShifts` writes only months whose JSON changed (a month left empty is written `[]`). `readShifts` reads every month in parallel, so screens and the archive still get the whole list; the save API (`useDriveList('shifts').save(fullList)`) is unchanged for every screen.
- Migration: an existing `shifts.json` is first renamed `shifts-old-<time>.json` (the rename is the lock between two managers; the copy is kept), then split into months; if the split fails it gets its old name back.
- Safety (from change-reviewer): a month file not read by this screen is expected absent (`expectAbsent`), so one created meanwhile is a conflict. A move writes the gaining month before the losing one; reads keep one shift per id, so a cut save shows it twice at worst, never zero. A restore also puts aside a leftover `shifts.json`. `findFile` orders by createdTime so duplicate names resolve the same way. If an app not yet updated writes `shifts.json` again, it is merged the same way, its shifts winning by id (a shift deleted meanwhile on a new app can come back in that case).
- Backup: `readAll` uses `peekShifts`, restore uses `restoreShifts` (replaces every month found on Drive). Backup file format unchanged.
- Spike skipped: same Drive calls already proven; the checksum falls back safely when absent. Not checked against the real Drive (sign-in needs Google); `npm run verify` green, 10 new tests. Opening the app still downloads every month; loading only recent months is a possible next step.

## Done: workers' details form by link (2026-11-04)

- Manager (עובדים tab, server mode only) taps "טופס פרטים לעובדים" and sends one link `/join/<code>` to the WhatsApp group. Workers fill it with no sign-in (`src/pages/JoinForm.tsx`, routed in `src/main.tsx` before the app and its sign-in).
- Server: `api/join.ts`. The form (code + the role/cert/department lists the manager has) and each answer live in Redis, sealed with SESSION_KEY (`join:form`, set `join:subs`). Public: GET lists, POST submit (same origin, cleaned to known fields, max 200 waiting). Managers (any allowed email): open (keeps the code unless renew), close, list, remove.
- Approval: answers wait at the top of the workers list; "בדיקה והוספה" opens the usual worker form filled from the answer (or the existing worker matched by ID number, then mobile, with the answer written over it). Saving is the approval and removes the answer. `src/lib/join.ts` holds the pure rules (tests in `join.test.ts`, server tests in `api/_lib/server.test.ts`).
- No spike: every part (server, Redis, WhatsApp share, worker form) was already proven here.
- One answer per person (user's ask, same day): the server keeps keyed hashes of each sender's mobile and ID number (`join:sent`) and refuses a second answer with either, even on a new link; the phone also remembers it sent and opens on "כבר שלחת". Deleting a waiting answer (the trash button) lets that person send again; adding it to the list does not.

## Done: security hardening + legal pages (2026-11-06)

- Two-step sign-in (TOTP, Google Authenticator) is mandatory for every manager after Google: `api/mfa.ts`, `api/_lib/totp.ts`, screen `src/pages/TwoStep.tsx` (lazy-loaded), 10 backup codes, owner resets a manager in Settings. Codes are claimed atomically (`kv.claim`), 8 tries / 15 min and 30 / day per email.
- Sessions are server-side (`api/_lib/session.ts`, `sess:<sid>`); every manager endpoint must use `requireManager`. Logout ends the session for real; "ניתוק מכל המכשירים" in Settings; removing an email ends all its sessions. Old cookies were invalidated (everyone signed in again once).
- Rate limits `api/_lib/rate.ts`; size-checked JSON `readJson`; owner-mode Drive relink needs a verified owner device.
- CSP and security headers in `vercel.json` (new outside origins must be added to `connect-src`).
- `public/privacy.html` rewritten, `public/terms.html` new; join form shows the collection notice + agreement checkbox.
- Owner lost phone AND backup codes: delete Redis key `mfa:<owner email>` in the Upstash console.
- Open: lawyer review of the texts, operator legal name on the pages, accessibility statement, privacy line if the voice assistant sends data to an AI provider.

## Done: voice assistant, phase 1 (2026-11-06)

- User request: a new default main screen with one big talk button; the manager says anything about the app, the system repeats it briefly, asks "לאשר, או שיש עוד תיקון?" after every correction, and acts only on a yes. Replies spoken, text one tap away. Owner only (shalom.eliy@gmail.com), $5/month budget, cheapest model. Spike: `docs/spikes/voice-assistant.md` (GO).
- Server: `api/assistant.ts` (requireManager + isOwner, rate bucket `assistant`, body up to 400KB, maxDuration 30 in vercel.json) calls `api/_lib/assistant.ts`: Claude Haiku 5.5, effort low, three strict tools `ask_user` / `answer` (+ openScreen) / `propose`. The server never changes data. Needs Vercel env `ANTHROPIC_API_KEY` (Production); without it the screen says the assistant is not connected.
- App: `src/pages/Voice.tsx` (tab "עוזר", default for the owner and in dev), `src/lib/assistant.ts` (snapshot of lists + shifts 7 days back / 28 ahead, `proposalErrors` sent back to the model up to twice, `applyProposal`), `src/lib/assistantApi.ts`, `src/lib/speech.ts` (he-IL recognition, stops after 2.5s quiet; speechSynthesis). A spoken "כן/מאשר/סגור..." confirms.
- Can do: new jobs (with a date into the calendar, without into "לשיבוץ"), auto-assign new or existing calendar jobs (planner `autoAssign`), new worker, new list item (places, jobTypes, roles, certifications, postponeReasons), answer questions on the data, open a screen. Cannot yet: delete, edit an existing worker/job, settings (it says so and opens the screen).
- Local testing: `vite.config.ts` serves `/api/assistant` in dev with the key from `.env.local` (no sign-in checks). Fake Drive with sample data: in the console `localStorage.setItem('dev.mockDrive','1')`, reload twice (`src/dev/mockDrive.ts`, dev only, not in the build).
- Privacy policy: added the assistant (data goes to Anthropic only when used).
- Verified in the browser with the fake Drive: the user's example asked for date/kind/description, proposal, correction (electrician only in Dimona + auto-assign Eilat), "כן, לאשר" saved two shifts to `shifts-2026-11.json` with a crew in Eilat; a data question answered; "תפתח לי את היומן" opened the calendar. 375 tests.
- Next: phase 2, the scheduling advisor (up to 5 ranked solutions), likely on a stronger model.
- 2026-11-06: bottom bar is now יומן, לשיבוץ, עוזר (raised amber button, center), עובדים, הגדרות. The archive opens from the top of הגדרות (Settings openArchive; tab id 'archive' still exists for the assistant's openScreen).

## Done: voice assistant, version 2 (2026-11-06)

- User feedback: speech-rate control, warmer colloquial persona, much better context understanding ("ראשון הקרוב כולל לינה" = date + לינה template; "לינה" is never a worker), act as an expert shift manager, "learn from data". Plus a bug: after a correction only approve/cancel showed.
- Speech rate: button "קצב" on the assistant screen cycles איטי / רגיל / מהיר / מהיר מאוד (0.8-1.5), kept in localStorage `assistant.rate` (`src/lib/speech.ts`).
- Persona and rules rewritten in `api/_lib/assistant.ts` (SYSTEM): veteran dispatcher, colloquial; word rules (shift kinds and roles are never names; check workers list first); dates looked up in `days`, not computed; job-card fields listed; warns about constraints, sick, double booking, night load.
- Snapshot (`src/lib/assistant.ts`): `days` (21 days by name), shift kinds with `meaning` and `hasNextJob`, worker department, open constraints (`cannot`), notes (200 chars), `history` (56 days: per worker jobs/nights/last/places/partners, per place jobs/last/work/crew), `remembered`.
- Proposal: `nextJob` per job (לינה only; waiting jobs get it in the note), `rememberNotes` / `forgetNoteIds`. New Drive list `assistantNotes` (`assistant_notes.json`, type `AssistantNote`); screen button "מה אני זוכר (N)" lists them with delete. Not in the backup list yet.
- "Learn from data" honestly: the model does not train; it gets the history counts and saved notes every turn.
- Confirm UI (user rule): a proposal shows "אשר" and "תקן" (equal buttons); "תקן" opens the mic (or the typing field) and the correction continues the conversation; cancel is a small link "ביטול, לסגור בלי לשמור" ("לסגור את השיחה" during questions).
- Model: `ASSISTANT_MODEL` env var (Vercel or `.env.local`) picks `claude-haiku-5-5` (default) or `claude-sonnet-5-5`; anything else falls back to Haiku (`pickModel`). Live comparison: `spikes/voice-assistant/v2.live.test.ts` (run with `LIVE=1 npx vitest run spikes/voice-assistant/v2.live.test.ts --dir .`). 5 sentences: Haiku ≈ $0.0025, Sonnet ≈ $0.04. Both got "ראשון הקרוב כולל לינה" right; on "את משה ולינה ביום שלישי" Haiku asked whether "לינה" was a worker (משה לינדה), Sonnet understood it as the לינה template.
- Verified in the browser (mock Drive, real Haiku): request -> proposal -> "תקן" -> correction to Sunday + לינה + next job in Dimona -> new proposal with אשר/תקן -> saved with `nextJob`.
- "Press here" (user request, same day): what only a person's tap may do (WhatsApp, share sheet) the assistant does not refuse; `answer.pressButton` opens the screen and blinks the button until tapped (`src/lib/hint.ts`, buttons carry `data-hint`: shareWeek, urgentNow, newJob, requestConstraints, joinLink; CSS `.hint-blink`). Verified: "שלח סידור עבודה בוואטסאפ" -> calendar with the share button blinking.

## Done: voice assistant, every action by voice + smart advisor (2026-11-06)

- User decisions: ordinary commands on the cheap model; a hard problem first warns about the cost, and only after "yes" goes to the smart model automatically. Every app action should be possible by voice, to shorten his work.
- New actions (`src/lib/assistantEdits.ts`, 13 tests): `editJobs` (edit fields, move date with moveShift, schedule a waiting job into the calendar, autoAssign), `setCrews` (named workers, swaps kept via crewSwaps), `closeJobs` (night jobs only, applyClosure), `deleteJobIds` (calendar or waiting), `editWorkers` (mobile, add/remove roles and certs, sick until / inactive / active), `addConstraints`. Tried on a copy in `proposalErrors`; a worker in two jobs is refused (busyCrew), sick crew is a spoken warning. Snapshot waiting jobs now carry ids.
- `propose` is no longer strict (with all actions the grammar was over the API limit, "compiled grammar is too large"); `normalizeProposal` fills every field before `proposalErrors`.
- Routing (`api/_lib/assistant.ts`): CHEAP_MODE / SMART_MODE system blocks. Cheap model calls `needs_smart` for hard problems; the screen says it costs about 4 cents and up to 30 s, button "כן, תחשוב לעומק" (or a spoken yes). Then `smart: true` goes to `SMART_MODEL` (claude-sonnet-5-5, effort medium, 55 s timeout; vercel.json maxDuration 60), which calls `advise` (up to 5 options). Options show as cards with "תעשה את פתרון N", which goes back to the cheap model to become a proposal.
- Still screen-only: settings, backup, monthly reports, Google Calendar sync, deleting a worker or a list item (the assistant opens the screen).
- Live flow check: `spikes/advisor/flow.live.test.ts` (LIVE=1, optional CMDS="a|b"). Haiku thinking blocks pass to Sonnet without error. Browser check (mock Drive): problem -> cost question -> deep answer -> 4 cards.
- Short readouts (user request, same day): 'מה יש לשיבוץ' reads only waiting jobs (place + what, opens לשיבוץ); 'מה משובץ ביומן' reads the range day by day (place, first names, 'חסרים N', opens the calendar); then asks 'לפרט?'. Adding a new worker by voice already worked (propose.workers), checked live.

## Done: worker state now (2026-11-06)

- User request: a sign on every worker card showing their state right now (fit, sick, vacation, studies) and a table; asked for more ideas. Added reserve duty (מילואים) and course (השתלמות).
- Model: an absence is a dated constraint with `kind` (`AbsenceKind`: vacation, study, reserve, course), so it blocks the planner and every busy/blocked check with no new code. Sick stays the worker status + sickUntil. `constraintText` reads the kind ("בחופש 8.11 עד 10.11").
- `src/lib/workerState.ts` (tests): `workerState` (inactive > sick > absence today > fit, with the last day), `teamStates` (counts in order), `endAbsence` (back to work today).
- Workers screen: "מצב הצוות היום" box with a chip per state and count (tap filters the list), a colored badge on every card. Worker editor status sheet: "כשיר לעבודה (חזר לעבוד)" also ends a current absence; new options חופש / לימודים / מילואים / השתלמות open a from-to date step.
- Voice: snapshot `now` per worker when not fit; `addConstraints.kind`; "חזר לעבוד" (status active) ends today's absence.
- Verified in the browser (mock Drive): vacation 6.11-12.11 on a worker -> badge "בחופש עד 12.11", team box "כשירים 3, בחופש 1".
- Revision (user, same day): the list card shows only a colored dot by the name (state in words inside the worker form; dot has aria-label). Each absence kind can be marked three ways: a date range, fixed weekdays every week (optional end date), or any days picked on a month calendar (`src/components/MonthDays.tsx`; days in a row join into one range, `daysToRanges` in dates.ts). Verified in the browser.
