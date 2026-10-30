# Spec: Shared data and staying signed in for months

Status: draft, waiting for the user's approval (2026-10-30). Expert fan-out: product (with design wording), architecture, QA, security (2026-10-29), updated after the user's decisions on 2026-10-30.

## Context and observed problem

1. Sign-in today is browser-only (GIS token model, `src/lib/google/auth.ts`): a 1-hour access token, no refresh token, one click each hour. A popup only opens from a click, so this cannot be silent without a server. The OAuth app is in "Testing", where a refresh token expires after 7 days.
2. Data lives in the Drive appDataFolder of whoever signs in. A second person signing in gets an empty app. The user (2026-10-30): "זה לא טוב לי שלכל אחד מידע משלו".

## User decisions

- 2026-10-29: a small server inside the same Vercel project, and publishing the OAuth app ("In production").
- 2026-10-30: more emails besides the owner's may sign in.
- 2026-10-30: option 1 of three: the data stays in the owner's Drive; the server is the guard at the door. Rejected: a shared Drive folder (needs a broad Drive scope, which Google reviews at length and cost), a new database holding all data (moving every list, much more work; kept as a future path if workers ever get access).
- 2026-10-30, storage estimate given to the user: about 2 to 5 MB per year of archive, far below Drive's free 15 GB.

## Target users

- The owner (the manager whose Drive holds the data), on phone and computer.
- Up to a few more people the owner allows by email (for example a deputy), each with their own Google account.

## Outcome

- Everyone allowed sees and edits the same schedule, workers and lists.
- Each person signs in once per device and stays signed in for months: opening, reloading or updating the app goes straight to the calendar.
- Two people editing at once never silently erase each other's change.

## Goal

- Owner connection: the owner signs in once with full consent; the server keeps the owner's Google refresh token (encrypted) in a small server storage.
- Everyone signs in with Google only to prove who they are (their email). The server checks the email against the allowed list and keeps them signed in with a long-lived session cookie.
- When the app needs Google, the server uses the owner's refresh token to give the app a short-lived access token for the owner's Drive (only this app's hidden folder) and the app's own calendar. The app's Drive and Calendar code stays as it is.
- The owner manages the allowed emails in Settings.
- Saves check that the file did not change since it was read; if it did, the app reloads it and asks to redo the change.

## Non-goals

- Worker accounts, different permission levels (everyone allowed is a full editor), our own database for the shift data.
- Live updates pushed between two open screens (the other person sees changes on reload or on next load of that list).
- Google app verification (not needed for a few users; an "unverified app" warning on first sign-in is accepted).

## Assumptions

- Server storage: one small free key-value store from the Vercel Marketplace (Upstash Redis), added by the owner with a click. It holds only: the owner's refresh token (encrypted), the owner's email, the allowed emails.
- Session cookies are signed and encrypted, `HttpOnly`, about 180 days. No Google token is kept in the browser beyond the 1-hour access token, in memory only.
- Secrets (`GOOGLE_CLIENT_SECRET`, cookie key, storage keys, owner email) are set only on the production deployment, never with a `VITE_` prefix.
- Local dev (port 5180) has no server functions; there the app falls back to today's popup and the signed-in person's own Drive. Nothing breaks.
- iPhone: the installed app may not share cookies with Safari, so it may need its own one-time sign-in.
- Scope category of `calendar.app.created` is unconfirmed; it only decides whether Google shows the "unverified" warning.

## Proposed experience

1. First setup (owner, once): sign in on the live site; the whole page goes to Google, owner approves (maybe an "unverified" warning, then "המשך"). The app is now connected to the owner's Drive for everyone.
2. Another allowed person: "התחברות עם Google", picks their account, sees the owner's schedule. Google only asks them to share their name and email, not their Drive.
3. Every later visit: a short "מתחבר..." moment, then the calendar.
4. Token runs out while working: renewed in the background, the save is retried once, nothing shows.
5. Email not on the list: "המייל הזה לא מורשה. בקש מהמנהל להוסיף אותו." Nothing is saved.
6. Owner connection broken (owner removed access in their Google account): everyone sees "החיבור לדרייב של המנהל נותק. המנהל צריך להתחבר מחדש." The owner sees a "חיבור מחדש" button.
7. No internet: "אין חיבור לאינטרנט", not a sign-out.
8. Edit conflict: "מישהו אחר שמר שינוי ברשימה הזו בינתיים. טענו את הגרסה החדשה, בצע את השינוי שוב." The other person's change is kept.
9. Settings:
   - Everyone: "מחובר כ-<email>", "התנתקות" (this device only).
   - Owner only: "מי יכול להיכנס": the allowed emails, add (typed email) and remove. Removing someone ends their access within an hour at most. And "ניתוק הדרייב" (stops the app's access to the owner's Drive for everyone, until the owner connects again).

Wording that becomes false is replaced: "החיבור לגוגל מתחדש כל שעה" (`SignIn.tsx`), "החיבור לגוגל פג (זה קורה בערך כל שעה)" (`errors.ts`), and "הנתונים נשמרים בחשבון הגוגל שלך בלבד" becomes "הנתונים נשמרים בגוגל דרייב של המנהל".

## System and data implications

- New server functions: start sign-in, Google callback, get an access token, sign out, owner disconnect, allowed-email list (read, add, remove; owner only).
- The browser no longer stores the access token in localStorage.
- The service worker must never touch `/api/...` (today it would cache the Google callback as the offline app); the SPA rewrite in `vercel.json` must skip `/api/`.
- Drive writes carry a version check (read the file's version, refuse to overwrite a newer one). This applies to every list.
- Existing data: already in the owner's Drive (the owner is the one who used the app so far). Nothing moves.
- Rollback: remove the server functions; the app falls back to the popup and each person's own Drive.
- Owner actions: Google Cloud project `masha7000` (publish the consent screen, add the redirect address, create a client secret); Vercel (add the free storage, paste the secrets). I give exact steps.

## Acceptance criteria (observable)

1. Owner signs in on the live site; a second allowed account on another device sees the same workers and shifts.
2. A change saved by one is visible to the other after a reload.
3. Both edit the same list at once: the second save is refused with the conflict message, and the first change is still there.
4. After reload, closing and reopening, and over an hour of waiting: the calendar opens with no sign-in screen and no popup, for both people.
5. Eight days later, still signed in (proves "In production").
6. An email not on the list is refused and gets no session.
7. The owner removes an email: that person is out within an hour, at their next token request.
8. "התנתקות" on one device leaves the other devices signed in.
9. "ניתוק הדרייב": everyone sees the "נותק" message; the owner reconnects with one sign-in and everyone works again with no action.
10. No `shiftsmart.token` in localStorage; the session cookie cannot be read by page scripts.
11. Offline: a message, still signed in; works again on reconnect with no click.
12. Local dev (5180): sign-in still works through the popup.
13. Security tests: wrong or missing `state` refused; token request from another site (foreign Origin) refused; a non-owner cannot change the allowed list; server answers carry `no-store`.

## States

- Loading: "מתחבר..." on start (times out to the sign-in screen).
- Empty: never signed in on this device: sign-in screen. Owner never connected: allowed people see "המנהל עוד לא חיבר את הדרייב".
- Error: Google refused / server error: plain message and the button again.
- Partial: server unreachable but internet works: an error with "נסה שוב" (no fallback to the person's own Drive on the live site, so nobody edits the wrong data).
- Recovery: one tap on "התחברות" (or the owner's "חיבור מחדש"); unsaved edits stay on screen.

## Accessibility, security, privacy, operations

- Plain Hebrew, `role="alert"` on messages, keyboard-reachable buttons.
- Refresh token encrypted (AES-GCM) before it goes into storage, key only in Vercel env; never sent to any browser.
- Session cookie: `__Host-` name, `HttpOnly`, `Secure`, `SameSite=Lax`, encrypted, with a key version so changing the key signs everyone out.
- Sign-in uses `state` + PKCE. The token endpoint accepts only POST from the app's own address, no CORS.
- An allowed person's browser receives the owner's 1-hour access token. It reaches only this app's hidden Drive folder and the app's own calendar, nothing else in the owner's Google account. Accepted.
- The allowed list is checked on every token request, so removal takes effect within an hour.
- Tokens and codes never logged. Secrets only on production; preview deployments get none.
- Cost: Vercel Hobby functions and the Upstash free tier, free at this scale.

## Verification plan

- Spike first: prove that Google returns a refresh token in the code flow, that it renews an access token with no user present, that a second Google account can sign in for identity only, and that the renewed owner token reads the owner's appDataFolder.
- Unit tests for the server logic with a fake Google and a fake storage: encryption and tamper, state, allowed list, owner-only list changes, foreign Origin, refresh, revoke.
- Client tests: silent resume, retry once after 401, offline vs disconnected, version conflict on save.
- Live checks with the user: criteria 1 to 9 and 11 on phone and computer with two accounts.

## Open decisions

- None blocking. Defaults taken from the user's answers: sign-out is per device; the owner can disconnect the Drive for everyone; every allowed person is a full editor. The user may change any of these.
