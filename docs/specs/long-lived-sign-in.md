# Spec: Stay signed in to Google for months

Status: draft, waiting for the user's approval (2026-10-29). Expert fan-out: product (with design wording), architecture, QA, security.

## Context and observed problem

Sign-in today is browser-only (GIS token model, `src/lib/google/auth.ts`). Google hands out a 1-hour access token and no refresh token. The token is kept in localStorage, so a reload within the hour is fine, but after an hour the manager must click "המשך" and a popup opens and closes. A popup can only open from a click, so this cannot be made silent without a server. The OAuth app is in "Testing", where any refresh token would expire after 7 days anyway.

User decision (2026-10-29): build option 2 from the thread, a small server inside the same Vercel project plus publishing the OAuth app to "In production".

## Target user and decision

The one manager, on a phone (installed app) and a computer. Decision they make: none day to day; they should simply never see the sign-in screen in a normal week.

## Outcome

- Sign in once per device; after that, opening, reloading or updating the app goes straight to the calendar for months, with no click and no popup.
- A failed renewal never loses an unsaved edit, and never shows a broken screen: it shows one clear "reconnect" button.

## Goal

- Server functions in the Vercel project (`/api/...`) run Google's code flow with offline access, keep the refresh token, and hand the app a fresh access token on request.
- The app renews silently on start and whenever the token runs out.
- Only the owner's Google account can sign in.
- The OAuth app is published ("In production"), so the refresh token does not expire after 7 days.

## Non-goals

- More than one manager, worker accounts, our own user database.
- Background sync while the app is closed.
- Google app verification (not needed for a single user; an "unverified app" warning on first sign-in is accepted).

## Assumptions

- No database: the refresh token lives in an encrypted cookie the browser holds and only the server can read.
- Server secrets (`GOOGLE_CLIENT_SECRET`, cookie key, allowed account) are set only for the production deployment, never with a `VITE_` prefix, never in the browser bundle.
- Local dev (port 5180) has no server functions; there the app falls back to today's popup by itself. Nothing breaks.
- On iPhone, the installed app may not share cookies with Safari, so it may need its own one-time sign-in. To be checked on the user's phone.
- Scope category of `calendar.app.created` (sensitive or not) is unconfirmed; it only changes whether Google shows the "unverified" warning, not whether it works. Checked in the spike.

## Proposed experience

1. First time on a device: sign-in screen, button "התחברות עם Google", line "מתחברים פעם אחת, והחיבור נשמר." The whole page goes to Google (not a popup), the manager picks the account and approves (once: a possible "האפליקציה לא אומתה" warning, then "המשך"), and comes back to the calendar.
2. Every later visit: a short "מתחבר..." moment, then the calendar. No button.
3. Token runs out while working: renewed in the background; the save that hit it is retried once. The manager sees nothing.
4. Connection really broken (access removed in the Google account, cookie gone): screen "החיבור לגוגל נותק. לחיצה אחת מחברת מחדש." with the email. Unsaved edits on screen stay.
5. No internet: a message "אין חיבור לאינטרנט", not a sign-out. "No internet" and "access removed" are different states.
6. Settings: "מחובר כ-<email>", "התנתקות" (this device only), and "ניתוק מכל המכשירים" (removes the app's access in Google, so every device must sign in again).
7. Another Google account tries to sign in: "החשבון הזה לא מורשה להיכנס לאפליקציה." Nothing is saved.

Wording that becomes false is replaced: "החיבור לגוגל מתחדש כל שעה" (`SignIn.tsx`), "החיבור לגוגל פג (זה קורה בערך כל שעה)" (`errors.ts`). The line "הנתונים נשמרים בחשבון הגוגל שלך בלבד" stays true (data stays in Drive), with "החיבור נשמר בצורה מוצפנת" added.

## System and data implications

- New server functions: start sign-in, Google callback, get a fresh token, sign out (this device / all devices).
- The browser no longer stores the access token in localStorage; it keeps it in memory and asks the server again after a reload. The remembered email may stay.
- The service worker must never touch `/api/...` (today it would cache the Google callback page as the offline app), and the SPA rewrite in `vercel.json` must skip `/api/`.
- `googleFetch` keeps its shape; Drive and Calendar code does not change.
- Rollback: remove the server functions and the app falls back to the popup on its own.
- User actions in Google Cloud (project `masha7000`): publish the consent screen, add the redirect address, create a client secret. In Vercel: paste three values. I will give exact steps.

## Acceptance criteria (observable)

1. After signing in on the live site, reload, close and reopen, and wait over an hour: the calendar opens with no sign-in screen and no popup.
2. Eight days later the app still opens signed in (proves the app is published, not in Testing).
3. localStorage has no `shiftsmart.token`; the browser holds an HttpOnly cookie the page's scripts cannot read.
4. Signing in with a different Google account is refused and leaves no cookie.
5. "התנתקות" on the computer shows the sign-in screen there; the phone stays signed in.
6. "ניתוק מכל המכשירים" removes the app from the Google account's third-party access list; the phone shows "החיבור לגוגל נותק" on its next request.
7. Removing access in the Google account settings: the next open shows the reconnect screen, no endless loop.
8. Offline: a message, the manager stays signed in, and on reconnect everything works with no click.
9. Local dev (5180): sign-in still works through the popup.
10. Security checks (tests): a callback with a wrong or missing `state` is refused; a token request from another site (foreign Origin) is refused; the server answers carry `no-store`.

## States

- Loading: "מתחבר..." while asking the server on start (short; times out to the sign-in screen).
- Empty: never signed in on this device: sign-in screen.
- Error: Google refused / server error: a plain message and the button again.
- Partial: server unreachable but internet works: fall back to the popup (needs a click).
- Recovery: any broken state is fixed with one tap on "התחברות"; unsaved edits stay on screen.

## Accessibility, security, privacy, operations

- Buttons and messages in plain Hebrew, alerts with `role="alert"`, the sign-in button reachable by keyboard.
- Cookie: encrypted (AES-GCM), `HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-` name, about 180 days. Key version inside, so changing the key signs everyone out (kill switch).
- Sign-in uses a random `state` and PKCE, checked on return. The token endpoint accepts only POST from the app's own address and sends no CORS headers.
- Only the account in the allowed-account setting can sign in (checked by Google's ID token on return).
- Tokens and codes are never written to logs.
- Secrets only on the production deployment; preview deployments get no secrets and fall back to the popup.
- Cost: Vercel Hobby functions, free at this scale.

## Verification plan

- Unit tests for the server logic with a fake Google: cookie encrypt/decrypt and tamper, state check, wrong account, foreign Origin, refresh, revoke.
- Client tests: silent resume, retry once after 401, offline vs revoked.
- Spike first (see `feature-spike`): on the live site, prove that Google returns a refresh token and that it renews an access token after the hour, with the app published.
- Live checks by the user: criteria 1, 2, 5 to 8 on phone and computer.

## Open decisions (for the user)

1. Sign-out: "התנתקות" only on this device, plus a separate "ניתוק מכל המכשירים". Recommended. Alternative: one button that always disconnects every device.
2. Who may sign in. User (2026-10-30): wants to allow more emails besides their own. So the allowed-account setting is a list of emails (comma-separated, in Vercel). Note: each account sees its own Drive, so a second email sees an empty app, not the owner's data. Open: is the second email another account of the owner, or a second person who must see the same schedule (sharing data is a separate, larger feature)?

## Expert notes: accepted and rejected

- Accepted: full-page redirect instead of a popup for the first sign-in (works in the installed app, no popup blocker); access token in memory only; service worker and rewrite must skip `/api`; allowed-account check; state + PKCE; key-versioned cookie; production-only secrets.
- Rejected: a key-value database for the refresh token (more to set up and pay for, no gain for one user); Google app verification (weeks of review, not needed for one user).
