# Handoff

## Done: v0.1 (2026-10-28)

- App skeleton: Vite + React + TS + Tailwind v4, RTL Hebrew, dark, mobile-first, bottom nav (יומן, עובדים, ארכיון, הגדרות). Only Settings is real; the other tabs are placeholders.
- Data types from the spec: `src/types/models.ts`.
- Google infrastructure: `src/lib/google/` (auth, drive, calendar). See `docs/spikes/google-connection.md` for decisions.
- Settings screen has a "בדיקת חיבור לגוגל" button that runs the full Drive + Calendar round trip.
- `npm run verify` passes (lint, tests (none yet), typecheck, build).

## Blocked on the user

The Google spike has not run live. The user must create an OAuth Client ID (Web application) in Google Cloud Console, with authorized JavaScript origin `http://localhost:5180`, enable Google Drive API and Google Calendar API, and add their account as a test user on the consent screen. The ID goes in `.env.local` as `VITE_GOOGLE_CLIENT_ID`.

## Next

1. User provides Client ID, runs the connection check. All 5 steps green = spike GO.
2. Then, per the pipeline: spec for the first real feature (likely workers + roles + shift definitions), plan, build.
