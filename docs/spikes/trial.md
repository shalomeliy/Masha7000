# Spike: 7-day trial for customer teams (2026-11-25)

## The riskiest assumption

A trial that ends must really close the door: the app, the outside API, and anything else that reaches the customer's Drive, without touching the owner's team or Dolik, and without deleting the customer's data.

## What the spike did

- Found every server path that opens a customer's Drive: only `customerToken` in `api/_lib/drive.ts`, used by `/api/token` (the app's Drive and Calendar token) and `/api/v1` (API keys). Forms (join, weekly constraints) never open the Drive on the server: they keep answers in the store and the open app pulls them, so they are not a door to the Drive.
- Throwaway patch: in `customerToken`, read the team record and refuse when `createdAt + 7 days` has passed and there is no `paidUntil` in the future.
- Throwaway test (a copy of the tenancy test harness, one extra case): a customer team approved 8 days ago gets no app token and its API key is refused, and Google Drive is never called. With `paidUntil` set, both work again. A root manager (Dolik's kind) keeps his token. The existing tenancy and API tests stayed green with the patch.
- The patch and test were removed afterwards (nothing of it is in the code).

## Result

- One check in one place closes every door to a customer's Drive. Root never passes through `customerToken`, so the owner and Dolik cannot be affected.
- The app keeps a token it already got for up to 1 hour, so a trial that ends may keep working up to an hour more. Acceptable for a trial.
- The customer's data stays in his own Drive. Nothing is deleted.

## Verdict: GO

## Decisions the owner still needs to make (before the plan)

1. When do the 7 days start: the day the owner approves, or the day the customer connects his Drive (recommended: when he connects, since before that he cannot use anything).
2. After the trial, what does the customer see: a full lock with "pay to continue" plus a contact button, or the app read-only (recommended: full lock, data kept, comes back the moment he pays).
3. Until Grow is connected, the owner marks a team as paid by hand in his customers list ("שולם עד ..."), and can add days to a trial (recommended: yes).
4. A warning before the end: a banner from day 5, "נשארו X ימים" (recommended: yes).

## Owner's decisions (2026-11-25): all four as recommended

1. The 7 days start when the customer connects his Drive.
2. After the trial: full lock, "pay to continue" and a contact button; data kept, back the moment he pays.
3. Until Grow: the owner marks "שולם עד ..." by hand in his customers list and can add trial days.
4. A banner from day 5: "נשארו X ימים".
Also: a team whose trial ended has its API keys refused (one gate in `customerToken`).
Next: `architecture-plan` -> `docs/plans/trial-PLAN.md`, then build.
