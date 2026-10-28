# Spike: Google connection from the browser

## Riskiest assumption

The whole app has no backend. Everything depends on the browser being able to sign the manager in to Google and then read/write Drive appDataFolder JSON and a dedicated Calendar directly.

## What was built

- `src/lib/google/auth.ts`: GIS token client (popup), in-memory token, `googleFetch` wrapper.
- `src/lib/google/drive.ts`: read/write JSON in `appDataFolder`.
- `src/lib/google/calendar.ts`: create/find the `Smart Shifts` calendar (id kept in Drive `settings.json`), list/upsert/delete events.
- Settings screen "בדיקת חיבור לגוגל": runs the full round trip (Drive write, Drive read, calendar, create event, read + delete event).

Scopes: `drive.appdata` and `calendar.app.created` (only calendars this app creates). Narrower than full `calendar`.

## Decisions

- Vite, not Next.js: the app is a pure client-side SPA, so Next.js adds a server layer that is never used.
- GIS token model, not PKCE code flow: Google's web PKCE token exchange still needs a client secret, which cannot live in a browser. Consequence: no refresh token; the manager re-confirms in a popup roughly every hour of use.

## Result

2026-10-28: the user signed in with their own Google account (test user, unverified-app warning accepted) and ran the connection check at `http://localhost:5180`. All 5 steps passed: Drive appData write, Drive read, `Smart Shifts` calendar created, event created, event read back and deleted.

Verdict: **GO**. The browser-only architecture from the spec works with the narrow scopes.
