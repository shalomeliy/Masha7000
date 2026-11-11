# Spike: the server reads the owner's Drive for an outside API

Date: 2026-11-11. Code: `api/spike-drive.ts` (throwaway, deleted after the verdict). Spec: `docs/specs/json-external-api.md`.

## Riskiest assumption

Every outside API call opens the owner's Drive from the server (Vercel): access token from the stored refresh token, list the month files, download them. It must be fast enough: target up to 2 s for one month of shifts, up to 5 s for a year.

## How it is run

The owner, signed in on https://masha7000.vercel.app, opens `https://masha7000.vercel.app/api/spike-drive`. The answer holds only timings and counts (no names, no data): token time and whether it was cached, the month files found, one month, the last 12 months, and the same 12 months again (warm).

## Results

Waiting for the owner's run.

## Verdict

Pending.
