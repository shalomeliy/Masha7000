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

## Next

Per the pipeline: `write-feature-spec` for the first real feature (likely workers + roles + shift definitions, stored in Drive), then plan, then build.
