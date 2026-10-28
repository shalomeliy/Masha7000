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

## Next

Hours: the user does not want to enter hours. Shift form has only "נגמרת למחרת"; times are fixed 07:00/16:00 (`SHIFT_START`/`SHIFT_END`), night = `endsNextDay: true`.

### Requested, not started: urgent shift "from now"
The manager must be able to open a shift starting right now, at any moment, including Friday and Saturday. When planning the rest of the week, the planner must take these shifts into account (e.g. who already worked one). Belongs with the weekly schedule feature; spec it together with that.

### v0.3 (requested, not started): closing a night job
After a night job the manager marks it: done fully (closed), partially (free text or Hebrew voice dictation), or postponed (reason from a user-managed list, e.g. "חסר אישור קונסטרוקטור", "תנאי מזג אויר", plus free text or voice). Riskiest part: Web Speech API Hebrew dictation (`webkitSpeechRecognition`, lang he-IL) on the user's phone. Spike that first. Open product question: what is a "night job" record (date, site/description, assigned workers?), since there is no schedule yet.
Next feature candidate: worker constraints (text + voice), or the weekly schedule screen. Ask the user which.
