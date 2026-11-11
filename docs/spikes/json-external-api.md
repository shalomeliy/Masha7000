# Spike: the server reads the owner's Drive for an outside API

Date: 2026-11-11. Code: `api/spike-drive.ts` (throwaway, deleted after the verdict). Spec: `docs/specs/json-external-api.md`.

## Riskiest assumption

Every outside API call opens the owner's Drive from the server (Vercel): access token from the stored refresh token, list the month files, download them. It must be fast enough: target up to 2 s for one month of shifts, up to 5 s for a year.

## How it is run

The owner, signed in on https://masha7000.vercel.app, opens `https://masha7000.vercel.app/api/spike-drive`. The answer holds only timings and counts (no names, no data): token time and whether it was cached, the month files found, one month, the last 12 months, and the same 12 months again (warm).

## Results (owner's 3 runs, 2026-11-11, Vercel region iad1)

| Step | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Access token (cached in the store) | 1 ms | 1 ms | 1 ms |
| List the month files | 327 ms | 333 ms | 488 ms |
| One month (18 shifts) | 191 ms | 262 ms | 243 ms |
| All months (2 files, 19 shifts), parallel | 503 ms | 355 ms | 364 ms |
| Same again (warm) | 336 ms | 341 ms | 451 ms |

A real "one month" API call = token + list + read = about 0.5 to 0.75 s. Target 2 s: PASS.

Limits of the run: only 2 month files exist yet, so "a year" was not really measured. Downloads run in parallel, so 12 months should cost about one download more than 2, not 6 times more (estimate, not measured). The token was cached every time; a cold refresh adds one Google call (not measured here, about the same as one list).

## Learned

- The month listing is the biggest single cost (about 1/3 to 1/2). The API can keep the file ids in the store for a minute to skip it on repeated calls, if ever needed.
- No server cache of the data itself is needed for now.

## Verdict: GO

Proceed to `docs/plans/json-external-api-PLAN.md`. `api/spike-drive.ts` deleted.
