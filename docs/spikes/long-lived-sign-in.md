# Spike: shared data and long-lived sign-in

Date: 2026-10-30. Code: `spikes/long-lived-sign-in/spike.mjs` (local Node server on port 5190, run with the user's real Google account).

## Riskiest assumptions tested

1. Google's code flow (with `access_type=offline`, `prompt=consent`, PKCE, `state`) on our existing Web OAuth client returns a refresh token for `drive.appdata` + `calendar.app.created` + `openid email`.
2. The server can later turn that refresh token into a fresh access token with nobody present, and that token reads the owner's appDataFolder.
3. A second Google account can sign in with `openid email` only.

## Results

1. PASS. The owner (shalom.eliy@gmail.com) approved; a refresh token came back and was stored. Google showed the usual consent; the ID token carried the email.
2. PASS. Refresh with only the stored token and the client secret gave a 3599-second access token, which listed the 9 app files in the owner's Drive (workers, shifts, pending jobs, lists).
3. NOT RUN: the user had no second account at hand. Identity-only Google sign-in is standard and low risk; it will be checked on the live site with the real second person.

## Learned

- Google no longer shows an existing client secret; a new one must be added (shown once). It lives only in `.env.local` locally and in Vercel env for production.
- While the consent screen is in "Testing", only listed test users can sign in at all, and refresh tokens expire after 7 days. Publishing ("In production") is required before the second person can use the app.
- The stored refresh token from the spike was deleted after the run.

## Verdict: GO

Proceed to `architecture-plan` for `docs/specs/long-lived-sign-in.md`.
