# Plan: Shared data and staying signed in for months

Spec: `docs/specs/long-lived-sign-in.md`. Spike: `docs/spikes/long-lived-sign-in.md` (GO).

## 1. Current architecture

- `src/lib/google/auth.ts`: GIS token client (popup), 1-hour token in localStorage, `googleFetch` adds the bearer and throws `AuthExpiredError` on no token / 401.
- `src/store/auth.ts`: zustand `signedIn` decided synchronously at load; `login` opens the popup; `logout` revokes and clears.
- `src/App.tsx`: `signedIn` false shows `SignIn`.
- `src/lib/google/drive.ts`: `readJson` / `writeJson` by file name in appDataFolder (find id, then GET media / PATCH media). No version check.
- `src/lib/data/useDriveList.ts`: one query per file, whole-list optimistic writes, serialized per file, rollback on error.
- `src/components/DriveError.tsx` + `src/lib/data/errors.ts`: Hebrew error text, re-sign-in button when auth expired.
- `public/sw.js`: caches every same-origin navigation as `/`. `vercel.json`: SPA rewrite of everything except assets/icons/sw/manifest.
- No server code exists.

## 2. Thin end-to-end slice

Owner signs in on the live site, a session cookie is set, the app gets an owner access token from `/api/token`, and Drive reads work with no popup after reload. Everything else (allowed list, conflict check, disconnect) builds on that slice.

## 3. Files

Server (new, Vercel functions, Web `Request`/`Response` handlers, TypeScript, no new dependencies):

- `api/_lib/env.ts`: reads and checks env: `VITE_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_KEY` (32 bytes base64), `OWNER_EMAIL`, KV url/token (`KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`), `APP_ORIGIN` (default `https://masha7000.vercel.app`). Missing any: `notConfigured`.
- `api/_lib/crypto.ts`: AES-256-GCM seal/open with WebCrypto, key version prefix (`v1.`), tamper = null.
- `api/_lib/cookies.ts`: parse, build `__Host-` cookies (HttpOnly, Secure, SameSite=Lax, Path=/), clear.
- `api/_lib/kv.ts`: tiny Upstash REST client over `fetch` (GET, SET with EX, DEL, SMEMBERS, SADD, SREM). Keys: `owner:refresh` (sealed), `owner:access` (sealed, EX 3300), `allowed` (set of lowercase emails).
- `api/_lib/google.ts`: build auth URL (state, PKCE S256; identity scopes `openid email`, owner adds Drive/Calendar scopes with `access_type=offline`, `prompt=consent`), exchange code, refresh, revoke, read email from the ID token (received straight from Google over TLS, per OIDC no signature check needed).
- `api/_lib/session.ts`: session = sealed `{ email, iat }`, 180 days; `requireSession(req)`; `isAllowed(email)` = owner or in `allowed`; `checkOrigin(req)` (POST only, `Origin === APP_ORIGIN`).
- `api/auth/start.ts` (GET): `?mode=owner` or default identity; sets `__Host-oauth` (sealed state + verifier + mode, 10 min), 302 to Google.
- `api/auth/callback.ts` (GET): checks state cookie, exchanges code, reads email. Identity mode: if email is the owner and no `owner:refresh` exists, 302 to `start?mode=owner`; if not allowed, 302 to `/?signin=not-allowed` with no session. Owner mode: email must equal `OWNER_EMAIL`, stores sealed refresh token, clears cached access. Sets the session cookie, 302 to `/`. Errors 302 to `/?signin=failed`.
- `api/token.ts` (POST): origin + session + allowed checks; returns `{ accessToken, expiresIn, email, isOwner }` from cache or by refreshing the owner token. Failures: 401 `{ reason: 'no-session' }`, 403 `{ reason: 'not-allowed' }`, 409 `{ reason: 'owner-disconnected' }` (no token, or Google says `invalid_grant`, which also deletes it), 503 `{ reason: 'not-configured' }`. All `/api` answers `Cache-Control: no-store`, no CORS headers.
- `api/logout.ts` (POST): clears the session cookie.
- `api/owner.ts` (POST, owner only): `{ action: 'disconnect' }` revokes and deletes the owner token; `{ action: 'list' | 'add' | 'remove', email }` manages `allowed` (email format check, lowercase, the owner is implicit and not stored).
- `tsconfig.api.json` + reference in `tsconfig.json`, so `npm run build` typechecks `api/`.
- `.env.example`: the server variables (no `VITE_` prefix) with a note that they go only to Vercel Production.

Client:

- `src/lib/google/auth.ts`: add server mode. `resume()` at start: POST `/api/token`; JSON answer means server mode (token in memory only, email, isOwner kept); 404 / non-JSON / network error / 503 `not-configured` means popup mode (today's code, unchanged, used in local dev and before setup). `googleFetch`: in server mode, no token or a 401 refreshes once via `/api/token` and retries; throws `AuthExpiredError` (with the reason) only if that fails; network failure throws `OfflineError`. `signIn()` in server mode = `location.assign('/api/auth/start')`; owner reconnect = `start?mode=owner`. `signOut()` in server mode = POST `/api/logout`.
- `src/lib/google/owner.ts`: client calls for the allowed list and disconnect.
- `src/store/auth.ts`: `status: 'checking' | 'signedOut' | 'signedIn' | 'ownerDisconnected' | 'notAllowed'`, `email`, `isOwner`, `mode`. Starts `checking`, calls `resume()`. Reads `?signin=` from the URL once and clears it.
- `src/App.tsx`: `checking` shows a small "מתחבר..." screen; non-signed-in statuses show `SignIn`.
- `src/pages/SignIn.tsx`: wording per status (spec section "Proposed experience"); remove the "every hour" line.
- `src/lib/data/errors.ts` + `src/components/DriveError.tsx`: new texts for disconnected, offline and conflict; conflict offers "טעינה מחדש".
- `src/pages/Settings.tsx`: "מחובר כ-<email>", "התנתקות"; owner-only `src/pages/settings/AccessSection.tsx`: allowed emails (add / remove, two-step remove), "ניתוק הדרייב" (two-step).
- `src/lib/google/drive.ts`: `readJson` also returns the file's Drive `version`; `writeJson(name, data, expectedVersion)` reads the current version first and throws `ConflictError` if it moved; returns the new version (PATCH with `fields=version`). A small window between check and write remains (accepted: two managers, rare).
- `src/lib/data/useDriveList.ts`: keeps the last known version per file (module map), passes it to writes, on `ConflictError` rolls back and refetches the list.
- `public/sw.js`: return early for `/api/`; `CACHE` to `shiftsmart-v2`.
- `vercel.json`: rewrite skips `api/`; header `Cache-Control: no-store` for `/api/(.*)`.

## 4. API and failure behavior

As listed per endpoint above. Client mapping: 401/403/409 set the matching status and show `SignIn` (unsaved edits stay because the editor sheet stays mounted until the user leaves it; the save just fails with the message); network error = offline message, status stays signed in; 503 not-configured = popup mode.

## 5. UI state model

`useAuth.status` drives App. Settings reads `email`, `isOwner`. The access list is a TanStack query (`['access']`) owned by `AccessSection`. Drive lists unchanged except the conflict path.

## 6. Tests (Vitest, cheapest layer)

- `api/_lib/*.test.ts`: seal/open round trip, tamper and wrong key rejected; cookie flags; auth URL has state, PKCE, offline only in owner mode.
- Handler tests with a fake KV and a stubbed `fetch` to Google: callback with missing/wrong state refused; non-allowed email gets no session; owner without stored token redirected to owner consent; `/api/token` foreign Origin refused, GET refused, cached token reused, `invalid_grant` gives 409 and deletes the token; non-owner cannot change the list; every answer has `no-store`.
- Client: `auth.test.ts` (stubbed fetch): resume picks server vs popup mode; 401 refreshes once then retries; second failure throws with reason; offline is not a sign-out. `drive.test.ts`: version moved gives `ConflictError`; unchanged version writes.
- Vitest `include` extended to `api/**/*.test.ts` if needed.

## 7. Risks, rollback, non-goals

- Production auto-deploys on push. Safe order: the code ships first and stays in popup mode (503 `not-configured`) until the owner finishes setup, so nothing breaks in between.
- Owner's 1-hour access token reaches allowed browsers (accepted in the spec).
- Cookie or KV key leak: changing `SESSION_KEY` signs everyone out and makes the stored token unreadable (owner reconnects).
- Vercel rewrite order: covered by excluding `api/` explicitly.
- Rollback: revert the commit; the client falls back to popup mode; delete the KV store.
- Non-goals: live push updates, roles/permissions, Google Calendar writing, worker access.

## 8. Ordered steps (verification after each)

1. Server libs (env, crypto, cookies, kv, google, session) + tests. Check: `npm run test`.
2. Endpoints start / callback / token / logout + handler tests. Check: tests, `npm run build` typechecks `api/`.
3. `sw.js`, `vercel.json`, `.env.example`. Check: build; read the rewrite.
4. Client server mode in `auth.ts` + store states + App/SignIn wording + tests. Check: tests; local dev at 5180 still signs in with the popup (browser).
5. Drive version check + conflict path + texts + tests. Check: tests; mocked conflict in the browser.
6. Owner endpoint + Settings account row + `AccessSection` + tests. Check: tests; Settings in the browser with `/api` mocked.
7. `npm run verify`, change-reviewer, fix. Commit and push (live stays in popup mode).
8. Owner setup with exact steps: Upstash Redis from Vercel Marketplace connected to the project; env vars in Vercel Production (`GOOGLE_CLIENT_SECRET`, `SESSION_KEY` that I generate into `.env.local` for him to copy, `OWNER_EMAIL`); redirect URI `https://masha7000.vercel.app/api/auth/callback` in Google Cloud; publish the consent screen; redeploy.
9. Live check with the owner: sign in, reload, add a second email, second person signs in on their phone, conflict test, sign-out per device. 8-day check left to the owner (reminder).
