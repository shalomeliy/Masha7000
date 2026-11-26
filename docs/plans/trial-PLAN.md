# Plan: 7-day free trial for customer teams

Status: APPROVED by the owner (2026-11-26), ON HOLD until close to launch. Until then there is no limit on customer teams: do not build or turn on the lock. When it is built, the lock stays behind a server switch (`TRIAL_ENFORCE=1` in Vercel), off by default, and the owner turns it on at launch. Spike: `docs/spikes/trial.md` (verdict GO).

## The owner's decisions (2026-11-25)

1. The 7 days start when the customer connects his Drive.
2. After the trial: full lock, a "לתשלום" button and a "צור קשר" button. Data is kept; the app opens again the moment he pays.
3. Until Grow is connected: the owner marks "שולם עד ..." by hand in his customers list and can add trial days.
4. From day 5 the customer sees a banner "נשארו X ימים".
5. A team whose trial ended has its outside-API keys refused too.

## What the code does today (checked)

- Every server path to a customer's Drive goes through `customerToken` in `api/_lib/drive.ts`: `/api/token` (the app's token) and `api/v1.ts` (API keys). Root uses `ownerToken` and never reaches `customerToken`.
- The customer links his Drive in `api/_lib/routes/auth-callback.ts` (`mode=team`), which writes `t:<id>:refresh`. No date is kept for it.
- `TeamRecord` (`api/_lib/team.ts`) has `createdAt` (approval time), no trial or payment fields. `updateTeam` changes only `claude` and `maxManagers`.
- The owner's customers list: `src/pages/settings/CustomersSection.tsx`, actions in `api/_lib/routes/owner.ts` (`team-claude`, `team-limit`, `team-remove`), all audit-logged.
- Claude, cloud voice and speech-to-text for a customer: `canUseClaude`/`canUseAssistant` in `api/_lib/session.ts` (`record.claude === true`).
- The app's sign-in states come from `/api/token` answers in `src/lib/google/auth.ts` (`ownerDisconnected`, `notAllowed`, ...).

## Design

**One pure function decides.** In `api/_lib/team.ts`:

```ts
trialState(rec: TeamRecord, now: Date):
  | { kind: 'not-started' }                 // Drive not connected yet: nothing to count
  | { kind: 'trial'; daysLeft: number; endsAt: string }
  | { kind: 'paid'; until: string }
  | { kind: 'ended'; endedAt: string }
```

- New optional fields on `TeamRecord`: `trialStartedAt?: string`, `extraDays?: number`, `paidUntil?: string` (a date, `YYYY-MM-DD`, open through the end of that day, Israel time).
- End = `trialStartedAt + (7 + extraDays) * 24h`. `daysLeft` = whole days left, rounded up (day 1 = 7, day 7 = 1).
- `paidUntil` today or later wins over everything. A past `paidUntil` with an ended trial = `ended`.
- Root has no `TeamRecord`, so it is never checked. The owner and Dolik cannot be locked.

**Start of the trial.** In auth-callback `mode=team`, on the first Drive connect only: `trialStartedAt = now` if it is not set. A reconnect never restarts it. A team that already has a Drive link but no `trialStartedAt` (approved before this version) gets it set the first time `customerToken` sees it, so nobody starts locked.

**The lock: one gate.** `customerToken` reads the record and, when `ended`, returns `{ reason: 'trial-ended' }` before it touches the cached token or Google. Then:
- `/api/token` answers `402 { reason: 'trial-ended', ...who }`.
- `api/v1.ts` answers `402 { reason: 'trial-ended' }` to an API key of that team.
- `canUseClaude` and the cloud-voice/STT check return false for an ended team, so the owner's budget is not spent on it even if "גם Claude" is on.
- Nothing is deleted: the refresh token stays, so paying (or added days) opens the app on the next token request, no reconnect.
- Known gap (from the spike, accepted): a token the app already holds keeps working up to 1 hour.

**What the app sees.**
- `/api/token` adds `trial: { daysLeft }` to a customer team's answer while in trial (nothing for root or paid).
- `src/lib/google/auth.ts`: new status `trialEnded` for the 402 answer, like `ownerDisconnected`.
- New screen `src/pages/TrialEnded.tsx` (full screen, nothing else reachable): "תקופת הניסיון הסתיימה. הנתונים שלך שמורים בדרייב שלך וחוזרים מיד אחרי התשלום." Two buttons:
  - "לתשלום": until Grow, opens WhatsApp to the owner (the `FAULT_WHATSAPP` number, from `GET /api/feedback`) with a ready message "אני רוצה להמשיך עם Shali, <business name>". When Grow comes, this button becomes the Grow payment link.
  - "צור קשר": the existing feedback form (`/api/feedback`), as its own small sheet.
  - Both routes stay open to a locked team (they only check `requireManager`, never the Drive).
- Banner from day 5 (`daysLeft <= 3`): a thin strip at the top of every screen, "נשארו X ימים לתקופת הניסיון", tap opens the same pay/contact sheet. Customer team owner and his managers see it; root never.

**The owner's controls** (customers list, root owner only, audit-logged):
- Each customer row shows a status chip: "ניסיון: נשארו X ימים" / "טרם חיבר דרייב" / "שולם עד 12.12.2026" / "הניסיון הסתיים" (red).
- "+ ימים" with 3 / 7 / 14 (adds to `extraDays`, max 60 in total).
- "שולם עד": a date field (`DateField`), and "בטל" to clear it.
- New `owner.ts` actions: `team-days { id, add }` and `team-paid { id, until | null }`. `updateTeam` learns these two fields only. No new function file (Vercel limit).

**Feature gate.** The trial is not a feature switch: it applies to every customer team and never to root. The screen and banner are gated by `who.root === false` and the server's answer only.

## Steps

1. `trialState` + the three record fields in `api/_lib/team.ts`; unit tests: not started, day 1, day 5 (3 left), day 7 end, ended, extra days, `paidUntil` today / past / future, Israel end-of-day edge.
2. Start on first connect in auth-callback (+ lazy start in `customerToken` for old teams); test: reconnect keeps the start date.
3. Gate in `customerToken`, `402` in `/api/token` and `api/v1.ts`, `canUseClaude` off when ended. Tests on the tenancy harness: ended team gets no token and no API access and Google is never called; paid again = works with no reconnect; root manager unaffected; a customer cannot call `team-days` / `team-paid` (403).
4. Owner actions `team-days`, `team-paid` + audit; the customers list chip, "+ ימים", "שולם עד".
5. App: `trialEnded` status, `TrialEnded.tsx`, the day-5 banner, the pay/contact sheet.
6. Every new string through `tx()` in all 15 languages (written in the session, never by the API). Guide: a short "תקופת הניסיון" paragraph in `src/lib/guide.ts` (+ translations).
7. `npm run verify`, then commit, push, merge to master.

## How the owner tests it (after the build)

- In the customers list, a test customer: "+ ימים" and "שולם עד" change the chip at once.
- Set a test team to ended (`שולם עד` yesterday and no days left): on that account the app shows the lock screen within an hour (at once after a fresh sign-in); its API key gets 402.
- Set "שולם עד" to next month: the app opens again on the next load, all data there.
- Your own account and Dolik's: nothing changes.

## Open for the owner

- The "לתשלום" button before Grow: WhatsApp to your fault-report number with a ready message (my pick, nothing new to set up). Say if you want a different number or an email instead.

## Out of scope

Grow payments and invoices (next stage), automatic reminders by WhatsApp or email, read-only mode, deleting data of teams that never pay.
