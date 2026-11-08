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
- Local testing: `vite.config.ts` serves `/api/assistant` in dev with a fixed stand-in answer (`api/_lib/assistantMock.ts`, no Anthropic call, no sign-in checks). The owner's manual tests can switch to the real, paid assistant with the dev-only button on the assistant screen (`src/dev/realAssistant.ts`, localStorage `dev.realAssistant`, header `X-Dev-Real-Assistant`, key from `.env.local`); Claude never turns it on. Real answers only on Vercel: `runAssistant` and the spikes refuse paid calls unless `VERCEL=1` (`api/_lib/spendGuard.ts`, CLAUDE.md "Never spend the API key locally"); the live spikes can no longer run on this machine. Fake Drive with sample data: in the console `localStorage.setItem('dev.mockDrive','1')`, reload twice (`src/dev/mockDrive.ts`, dev only, not in the build).
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
- Model: `ASSISTANT_MODEL` env var (Vercel) picks `claude-haiku-5-5` (default) or `claude-sonnet-5-5`; anything else falls back to Haiku (`pickModel`). Live comparison: `spikes/voice-assistant/v2.live.test.ts` (run with `LIVE=1 npx vitest run spikes/voice-assistant/v2.live.test.ts --dir .`). 5 sentences: Haiku ≈ $0.0025, Sonnet ≈ $0.04. Both got "ראשון הקרוב כולל לינה" right; on "את משה ולינה ביום שלישי" Haiku asked whether "לינה" was a worker (משה לינדה), Sonnet understood it as the לינה template.
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

## Changed: one model only, learning from the manager (2026-11-07)

- User decision: always the cheap model (Haiku 5.5), no costlier model and no cost question; it should keep getting better from his answers.
- Honest limit: the model never retrains. What "learning" is here: (1) `lessons` in every proposal, short general rules the model writes when the manager corrected it or picked a solution; saved with the yes as notes marked `learned` (tag "למדתי" in "מה אני זוכר", deletable); (2) every confirmed request is kept as an example (`assistantExamples`, Drive `assistant_examples.json`, last 200: what he said / the summary he approved); the 6 sharing the most words with what he just said go into each turn (`relevantExamples`).
- Removed: `needs_smart`, SMART_MODE/SMART_MODEL, the `smart` flag in the API and app, the cost button. The advisor (`advise`, up to 5 cards) now runs on the same model. Effort raised to medium for every turn (slower: a hard problem took about 20 s on Haiku in the live check). MODE block cached.
- Live check (`spikes/advisor/flow.live.test.ts`): a hard problem gets advise directly on Haiku; picking option 1 became a proposal (a sick date it left out was refused and goes back to it).
- Faster answers (user picked options 1+2, same day): the advisor gives 2-3 short options, `spoken` first. `/api/assistant` now streams JSON lines (`assistantStream`): `{early}` = the first spoken field of advise / ask_user / answer as soon as its string is complete (`earlyText`, tested), then `{reply}` or `{reason}`; pre-checks still answer plain JSON. Dev middleware streams too; `askAssistant(messages, context, onEarly)`; Voice speaks the early text and does not repeat it. Not for `propose` (it may be refused and sent back).
- Measured (Haiku, the Dani-sick problem): with effort medium the recommendation is heard after about 16 s (was about 20 s for the whole answer); most of the time is the model thinking before it writes. With effort low it was heard after about 10 s with a similar answer; left at medium, the user's call.
- Advisor count (user rule, same day): only as many options as needed (one when clear, two on a real dilemma, never more than three); 'more options' calls advise again with the previous ones plus one or two new, three at most.

## Done: the planner solves, the model ranks and words (2026-11-07)

- Spike `docs/spikes/solver.md` GO; user said build, keep learning from his answers, and let him update rules by voice.
- `src/lib/solvers.ts` (6 tests): `solve(d, problem)` for `missing` (workers drop out of a job), `job` (a job lacking people), `day` (a day's jobs lacking people, job by job so nobody is used twice). Options: replace/fill now; only if that fails, move to the first day in 10 with a full crew; or go short. Every option carries `changes` (Edits). `optionsText` is the tool result; no options -> the model uses `advise`.
- Server tools: `solve {kind, shiftId, workerIds, date}` and `rank {spoken, order, notes}`; `advise` is now only the fallback (week overload, open questions). Effort back to low (the planner does the thinking). `rank.spoken` streams early.
- App (`Voice.tsx`): on `solve` the app computes and sends the options back (once per turn); on `rank` it shows them in the model's order with its notes (e.g. a saved rule the planner cannot read). Picking a planner option makes the proposal at once, no model call (checked by `proposalErrors`; if stale, the model redoes it).
- Learning: picking another kind than the top-ranked one adds a learned rule (`preferenceLesson`), saved with the yes, read by the ranker next time; examples and lessons as before. Rules by voice: add / update (forget old + remember new) / forget / read them.
- New jobs can name workers (`jobs[].crew`), checked for roles; autoAssign fills the rest. Before this the model claimed it had placed named workers on a new job but nothing did it.
- Measured on Haiku: about 5 s warm for "Dani is sick" (first call after a prompt change about 8 s), about 3 s for "people missing on Tuesday". Browser check (mock Drive): job created with named crew -> "Dani is sick" -> 1 option card -> picked -> instant proposal -> saved with Avi in Dani's place.

## Done: no worker in two jobs at once, from anywhere (2026-11-07)

- User request: make sure nothing can put one worker in two overlapping jobs; when something tries, the manager is warned (on screen or spoken) and confirms the move.
- Audit of every path that writes a crew: shift editor (busy save refused; pulling a busy worker asks first, `pullFrom`); calendar drag (refused with the reason); auto-assign and week planner (`autoAssign` skips busy, `planShifts` sequential); solvers (via autoAssign, `day` job by job); voice `setCrews` / `editJobs` (already checked). Gap found and fixed: voice new jobs with named crew (`jobs[].crew`) were not checked.
- Voice now (`applyProposal`): after all changes, every placed or moved job is checked with `busyCrew`. A clash with a job the proposal does not touch is a move: `conflicts` ("דני כבר משובץ באותו זמן ב... אם תאשר, אעביר אותו ל..., ושם יישאר מקום ריק"), said before "לאשר, או שיש עוד תיקון?" (`summaryWithConflicts`) and shown as an amber alert; the yes runs `pullFrom`. A clash inside the proposal or with a closed job is refused (`errors`, sent back to the model). Tests in `assistantEdits.test.ts`.
- Browser check: new Dimona job naming Yossi while he is in Eilat the same day -> the assistant asked to move him -> after the yes Eilat kept only Avi, Yossi only in Dimona.

## Done: app languages (2026-11-07)

- Settings has a "שפה · Language" picker at the top: Hebrew + the 14 most spoken languages (en ar ru es fr de pt zh hi bn ur id ja tr). Hebrew, Arabic and Urdu are right-to-left; the others left-to-right (chevrons flip by CSS). The app name "Shaly" stays in English. The choice is per device (`localStorage app.language`) and reloads the app.
- Every UI text is Hebrew in the code, wrapped as `tx('עברית', { param })` from `src/i18n`. Translations live in `src/i18n/locales/<code>.json` (Hebrew -> translation), lazy-loaded before the app modules (`src/main.tsx` -> `src/boot.tsx`). A missing text falls back to English, then Hebrew. Day/month names come from `Intl` (`dayNames`, `monthNames`).
- Rule from the user: every new UI text must be wrapped in `tx()` and translated into all 14 languages in the same change. The test `src/i18n/i18n.test.ts` fails when a language file misses a text or a `{placeholder}`. `node scripts/i18n-keys.mjs` lists all texts. Translations are written by Claude in the session, never through the app's API key.
- Voice assistant: listens and speaks in the picked language; the server tells the model to answer in it (`languageNote` in `api/_lib/assistant.ts`, whitelist of names). "Yes" is recognized in every language. The model still reads the data and its instructions in Hebrew.
- Left in Hebrew on purpose: the WhatsApp constraints request and the parser of workers' replies (`src/lib/constraints.ts`), the manager's own list items, anything only the model reads.
- Shift editor (user rule 2026-11-07): a busy worker in the crew is a warning, not a wall. The first "שמירה" says who is busy where and that pressing it again moves them (`moveAsked`, keyed by the busy worker ids); the second press saves and pulls them out of the other jobs (`pullFrom`, their place left empty). A busy worker in a closed job still has to be replaced. New text translated into all 15 languages. Browser check: Dimona moved onto Eilat's day with Avi in both -> warning -> second save -> Avi only in Dimona, Eilat empty.
- Several busy workers (user, same day): after the first "שמירה" each busy worker is listed with "יעבור לכאן" and a "להשאיר אותו שם" button (he leaves this job's crew instead); the second "שמירה" moves only the ones still listed. Checked in the browser: Avi and Yossi busy, Yossi kept in Eilat, only Avi moved to Dimona.

## Done: free voice commands, learned from Claude (2026-11-07)

- User request: spend the Anthropic credit only where needed; the app should learn from what Claude did and do the same kind of request alone next time (after one or a few times), for every action where possible. Spikes: `docs/spikes/free-commands.md` (CHANGE: fixed rules alone catch little), `docs/spikes/learn-actions.md` (GO).
- `src/lib/freeCommands.ts`, used by `Voice.tsx` before Claude, Hebrew only, only while Claude is not in the conversation: fixed core (open a screen, the five assistant buttons with the blink hint, "who works" on today / tomorrow / a weekday, answered from the data); learned actions: a new job (with local questions for missing details, `continueJob`) and a worker sick (marks sick; when he is in a job, the planner's replacement options at once, the sick mark goes with the picked option via `Advice.extra`). A spoken yes on such options takes the first.
- Learning: on every confirmed Claude proposal `exampleAction` keeps `AssistantExample.action` (one new job, or one worker sick). `learn()` gets action words, aliases ("מטפסים" = טפסן) and required fields from them. A sentence is handled only when every word is explained; otherwise everything said so far goes to Claude as one turn. Local proposals are checked with `proposalErrors` first.
- Counter on the assistant screen: free vs Claude turns this month, localStorage `assistant.usage`.
- Next: more learned actions the same way (on leave / constraints, assign a named worker, move a job), each with its own test set in `src/lib/freeCommands.test.ts`.
- Names by closeness and values as slots (2026-11-07, user's rule): worker names in free commands are matched by sound (`src/lib/nameMatch.ts`: typos, speech recognition, English spelling either way). Clearly closest = that worker; two about equally close = "למי התכוונת, X או Y?" (answered by first name, last name or "השני", `continueWho`); none close enough = "לא מצאתי עובד בשם X", free. Learning keeps only the action words: the example's own values (date in digits, a new place, a misspelled name, counts) are slots. New date forms: 15.11, בעוד יומיים, בעוד N ימים; counts in digits. Tests: `freeCommands.test.ts` (32 with `nameMatch.test.ts`). The skill `free-commands` has both rules for future actions.
- Open (2026-11-07, user report): similar requests said several times still went to Claude. Not diagnosed: the user's sentences are not readable from here (Drive appDataFolder is locked to the app, and only confirmed requests are saved). Likely causes: an action type not learned yet (only new job and sick are), not the first sentence of the conversation (free path only before Claude joins), or an unknown word. Next, recommended to the user: keep a log of every sentence sent to Claude with the reason the free path refused it (action not learned / not first sentence / unknown word X), shown in Settings with a "copy" button, so the user can paste it and the learning can be fixed from real use. Ask the user for the sentences he remembers.
- Done (2026-11-07): the "what went to Claude" log. Every conversation the voice assistant sends to Claude is kept with why the free path did not do it (`whyNotFree` in `src/lib/freeCommands.ts`: no learned action matches / words not learned for that action, quoted / names a worker / not Hebrew / an answer to a free question not understood), what the free path did understand (workers, date, place, roles), what Claude did each turn (propose summary, answer, ask, advise) and how it ended (answered, confirmed + which action was learned from it, cancelled, failed). Client: `src/lib/claudeLog.ts`, wired in `Voice.tsx`. Server: `api/claude-log.ts` + `api/_lib/claudeLog.ts`, owner only, one sealed list in the store (`claude-log`, last 300, kept 120 days), no Supabase needed. The last 100 also stay on the device in case the server is not reachable.
- Reading the log: Settings > "העוזר הקולי" > "מה הלך ל-Claude": count, the last 5 sentences with how they ended, a copy button (plain English text for a dev session), and clear. A dev session can also pull it without the owner pasting: `node scripts/claude-log.mjs [--last 20]`, which needs the read-only key `CLAUDE_LOG_TOKEN` (32+ characters) set in Vercel env and in `.env.local`; not set up yet (owner's choice). Locally the dev server keeps the log in memory.
- Done (2026-11-07): a new job in any phrasing, free from the first time. Built-in verbs (`JOB_VERBS`: תפתח, תייצר, תיצור, תכניס, תוסיף, תרשום, תקבע, תשים, תגדיר and forms) with "עבודה", or "עבודה חדשה". No field is learned as required any more: only the kind (asked, or the one kind when there is only one) and a place or a description (asked "איפה?") are needed; a date only when "ותשבץ" was said. No date goes to לשיבוץ (pendingJobs), a date to the calendar. Still to Claude: "העבודה"/"לעבודה"/"עבודות" (an existing job or several), a named worker, a question or other action word in the free text, a bare number. Fixes found on the way: small words (לי) are never read as a worker's name (לי was matched to אלי), and role plurals keep the final letter (טפסנים = טפסן). Tests: 38 in `freeCommands.test.ts`.
- Done (2026-11-07): a new worker, free from the first time (`newWorker`): a verb (`WORKER_VERBS`) + "עובד/עובדת" + a name of 1-3 words in a row, an optional phone (05x, +972, with dashes or spaces) and roles said by name. A name already in the list is said back free. To Claude: two phones or "עובדים" (several), "לעובד"/"העובד" (an existing worker), a date, kind or job type, a count of a role, a question. Checked in the dev server with the fake Drive: job with no date went to pending_jobs.json and the worker to workers.json, both counted free. Tests: 42.
- Fixed (2026-11-08, owner report: "תכניס לי עבודה בערד עבודה לילה החלפת אנטנה" went to Claude): a place not in the lists stopped the job. Now a place is also found by its first word ("בערד" = "ערד 17" when only one place starts with it), and unknown words said with ב are the place: "בירוחם החלפת כבלים" = place ירוחם + description; two-word towns kept (`TOWN_FIRST`: באר שבע, קרית גת...); descriptions that start with ב are not places (`WORK_START`: בדיקת...). Two places, or two unknown runs without ב, still go to Claude. Tests: 51. Then (same day, owner's rule: anything said after ב is a place): the place after ב may be a town, a name, a number or both ("בערד 17", "ב-556", "בבאר שבע 9"); every place a job (calendar or לשיבוץ) was already at counts as known, so a long name said once is matched whole next time. Limit: a new multi-word name never used before is cut after its first word (two-word towns excepted); the summary shows it and the owner corrects. Tests: 52.
- The loop: the owner uses the assistant, the log fills, a dev session reads it and teaches the next free action with the skill `free-commands`. Honest limit, told to the user: repeated request shapes become free; new or unclear requests will still go to Claude.
- Done (2026-11-08): one long sentence with several requests. `splitFree` in `src/lib/freeCommands.ts` cuts it (punctuation, וגם/ואז/ובנוסף/אחר כך, a verb or question word with ו; a "ו" before a name only when every piece is known). Known parts are done free and joined into one proposal; only the unknown part goes to Claude (whole sentence as context, "do not do the rest"), and only that part is logged and learned. Claude's proposal joins the local one in one read-back (אשר/תקן); a correction hands all of it to Claude. A correction-like part ("לא, ביום שלישי") or a lone detail sends the whole sentence to Claude. Checked in the dev server with the fake Drive and the stand-in: all-known sentence = one free proposal; mixed = only the unknown part reached the stand-in and the log, then the local job was offered. Tests: 8 new in `freeCommands.test.ts`. The skill `free-commands` now also tells each run to look for cheaper ways first (split misses, repeated parts, repeated combinations, one missing word).
- Weekly routine (2026-11-08, user's yes): reads the log and runs the skill `free-commands` once a week. It needs `CLAUDE_LOG_TOKEN` (Vercel env + where the routine runs) to read the log; without it the routine has nothing to read and says so.

## Done: worker's personal calendar (2026-11-07)

- The worker's card (edit form) has a "הלוח האישי" block under the status line, for saved workers only: their jobs from today on (date, place and work, template or "עבודה דחופה", their role, "עד" the last day for a night job) and their days away (sickness, vacation and the other absences, picked days, ordinary dated constraints), in date order; an absence going on today sorts as today. Weekly constraints are listed apart as "קבוע כל שבוע". First 4 items, then "להציג הכל". Built from the form's draft, so a status or absence just picked shows before saving.
- Logic in `src/lib/workerAgenda.ts` (tests next to it), view in `src/pages/workers/WorkerAgenda.tsx`. New texts translated into all 15 languages.
- Browser check at phone width with the in-memory Drive mock: 4 jobs (one night, until the next day), an evening constraint, a vacation and a weekly study day, all in order.
- Sickness ahead (2026-11-07): a new absence kind `sick` for sickness on given days (e.g. starting tomorrow), offered in the status sheet as "מחלה בימים מסוימים". The voice assistant saves "X חולה מחר" as a dated constraint with note "מחלה" and no kind; `normalizeConstraint` reads that as kind `sick`. So it shows red in the personal calendar, and the worker's state is "במחלה" on that day (not today). Sickness from today stays `status: 'sick'` + `sickUntil`.
- User's rule (2026-11-07): the personal calendar shows only the next 3 days (today included), and each constraint is shown once. A constraint in the calendar is left out of the card's constraints list (`agendaConstraintIds` -> `ConstraintsField hidden`) and is removed with the X on its calendar row. Weekly constraints, later dates and WhatsApp guesses stay in the list. No "show all" any more.
- Monthly calendar (2026-11-07): a tap anywhere on the personal-calendar box (or its 'לוח חודשי' heading) opens the worker's month (`src/pages/workers/WorkerMonth.tsx`, logic `workerMonth` in `src/lib/workerAgenda.ts`). A month grid with a colored dot per kind (job, sickness, vacation, study, reserve, course, other constraint) and a legend, month arrows, a count of jobs and days away, then every day of the month with its entries (a night job on both its days, the second as 'המשך מ-'). Status sickness has no start date, so it shows from today on. The X on a calendar row stops the tap from opening the month.
- Fixes (2026-11-07, user's screenshots): the personal calendar always shows 3 rows, today, tomorrow and the day after (`agendaDays`); an empty day says 'פנוי', a day a longer absence or night job runs on says 'המשך: ...'. 'X חולה ביום שלישי' was shown as a yellow 'לא זמין': the voice save (`applyProposal` addConstraints) now runs `normalizeConstraint` at once, so a day noted 'מחלה' is kind `sick` (red) without a reload; Claude may also send kind `sick`. The edit-worker constraints list hides constraints that already ended (no '(עבר)'); they stay saved and show in the month. A sickness row in that list is red.
- User's rule, again (2026-11-07): for a saved worker the constraints list at the top of the card shows no dated constraints at all (only weekly, 'always' and WhatsApp guesses; `ConstraintsField calendar`). Dated ones are seen and removed only in the personal calendar (next 3 days) and in the month (`WorkerMonth onRemove`, an X on every dated entry). Both removals go into the draft and are saved with 'שמירה' (checked on the fake Drive). A new worker (no calendar yet) still lists them.
- Sickness of several days (status `sick` + `sickUntil`) now has a pencil (opens the status sheet to change the last day) and an X (back to work) on its row, in the personal calendar and in the month (`removeAway('sick')`, `editSick` in WorkersSection). Saved with 'שמירה' (checked on the fake Drive). A sick chip on the worker list card is red.
- Every absence row in the personal calendar and the month (vacation, study, reserve, course, dated sickness, plain day) also has a pencil: it opens that constraint's editor in the constraints list at the top of the card (`ConstraintsField open`, `editAway`), kind kept. Status sickness's pencil opens the status sheet.

## Done: budget left on the assistant screen (2026-11-07)

- User request: show on Shaly's screen how much of the monthly Anthropic budget is left. A regular API key cannot read the account's balance, so the server counts it itself (no new key): after every paid answer `api/assistant.ts` adds the cost (`api/_lib/budget.ts`: usage tokens x the model's price, cache writes 1.25x, cache reads 0.1x, Haiku's long-prompt price above 100K) to `spend:YYYY-MM` in the store (UTC calendar month, in millionths of a dollar), and the first day counted to `spend-since:YYYY-MM`. Cap: Vercel env `ASSISTANT_BUDGET_USD`, default 5.
- `GET /api/assistant` (owner only) returns `{ budget: { spentUsd, limitUsd, since } }`; each POST's last line carries the new total too. The screen shows "נשאר מהתקציב החודש: $x מתוך $5" with a bar under the talk button (amber under 20%), and "נספר מ-<date>" when counting started after the 1st (spending before it is unknown).
- Limits: it sees only this app's calls since 2026-11-07; spending on the same Anthropic account from elsewhere is not counted. The exact match to the Console would need the Admin API (an `sk-ant-admin` key, cost report endpoint, server only): offered to the user, not built.
- Local: the dev server answers GET and the stand-in stream with a made-up budget marked "בדיקה מקומית: מספר דמה" (`mockBudget` in `api/_lib/assistantMock.ts`).

## Done: workers who must be in a job, and the nearest days they are free (2026-11-08)

- User request: when creating a job, name workers it cannot go without (e.g. יוסי and ניר), maybe with more open places, and get the nearest dates all of them are free. Built from parts already proven (`autoAssign`, the move-advice day scan), so no spike.
- Logic: `src/lib/pinnedDates.ts` (`datesForPinned`): from today, up to `ADVICE_DAYS` (60) ahead, at most 3 days where every pinned worker is active, not blocked by a constraint/sickness and not in another job at the same time (a night job blocks its next day too), and "שבץ" fills every other place. The weekly night limit is a warning on the option, not a block.
- `ShiftRecord.pinnedIds`: saved only for workers still in the crew. "שבץ" and "שבץ את השבוע" already keep crew members; `swapOn` (move advice) now gives no swap that takes a pinned worker out. Removing or swapping one by hand unpins him.
- Job form: `src/pages/calendar/PinnedField.tsx`, a green box under "כמה אנשים צריך": "+ עובד שחייב להיות", chips with X (removes from the job too), "מצא יום שכולם פנויים" -> up to 3 days with who else joins; picking one sets the date and crew. Pinned crew rows show a lock.
- Voice, free (`src/lib/freeDates.ts`, hooked in `handleFree`/`continueJob`): "תמצא לי מתי יוסי וניר פנויים לעבודת לילה בערד" (also "ועוד חשמלאי", a place not in the lists said with ב, "אחרי <date>"). A missing kind or place is asked first. Says up to 3 days; "הראשון/השני" (or yes for one) gives a ready new job with them pinned (`SolverOption.proposal`), confirmed as usual. Jobs from the assistant with named crew are saved pinned too.
- Tests: `pinnedDates.test.ts`, `freeDates.test.ts`. Browser check on the mock Drive: יוסי on vacation 8-9.11, night job in ערד with יוסי and דני -> 10, 11, 12.11 offered, picked 10.11, saved with `pinnedIds`.
