# Plan: smart onboarding, stage 1 part 2 (customers on their own Drive)

Status: draft, waiting for the security review and the user's go. Part 1 (features on/off, wizard, guide, Shali) is built.

## The user's decisions (2026-11-24)

- A new customer **requests** access; the owner approves. No open sign-up.
- Each approved customer works on **his own Google Drive** and sees only his own data. Existing managers (Dolik) stay on the owner's Drive.
- A customer can add **several managers** to his own Drive, as many as his plan allows (small 1, medium 10, large 30). Until payments exist, the owner sets the number when approving.
- New customers: Shali free commands only (no Claude) until the owner turns Claude on.

## What the code does today (checked)

- One team only. `/api/token` gives every allowed manager the owner's Drive token (`api/_lib/drive.ts ownerToken`, refresh token in `KEYS.refresh`).
- Everything in the store is global, for that one team: `allowed`, `assistant`, `assistant-claude`, join and constraints forms (`join:*`, `cons:*`), outside-API keys (`apikey*`), `claude-log`, `audit-log`, `api-log`.
- The owner links Drive through `/api/auth/start?mode=owner` (offline consent, scopes checked) in `api/_lib/routes/auth-callback.ts`.

## Design

**Team = the Drive the data lives in.** `teamId` = the team owner's email. The owner's team is the root team and keeps its current keys exactly as they are (no migration, nothing moves for Dolik).

New store keys (all sealed where they hold personal data):
- `team:<id>`: `{ owner, maxManagers, plan, businessName, whatsapp, createdAt, claude: false }`.
- `member:<email>` -> `teamId` for every manager of a customer team (root-team managers have none: they stay in `allowed`).
- `t:<id>:refresh`, `t:<id>:access`: the customer's own Drive tokens.
- `t:<id>:join:*`, `t:<id>:cons:*`, `t:<id>:apikeys`: the same forms and keys, per team. Public form codes and API key records carry the `teamId`, so a worker's form and an API call land in the right Drive.
- `access-requests`: sealed list of pending requests (email from Google, business name, WhatsApp, time), max 200.

One helper decides everything: `teamOf(env, email)` -> `{ teamId, isTeamOwner, isRoot }` or null. `requireManager` returns it, and every route uses its keys through `teamKeys(teamId)`. A route that reads a root-only key (Claude log, budget, audit, owner controls) checks `isRoot`.

## Steps

1. `teamOf` + `teamKeys` in `api/_lib/team.ts`, tests: root manager, customer owner, customer manager, unknown email, removed member.
2. Sign-in: `isAllowed` = root allowed list OR `member:<email>` OR a team owner. Sessions unchanged.
3. Customer Drive link: `mode=team` in auth start/callback (same offline consent and scope check as the owner), refresh stored in `t:<id>:refresh`. First sign-in of an approved customer: two-step first, then "חבר את הדרייב שלך" screen with the guide text (what he grants and why).
4. `/api/token` and `api/v1.ts` use `teamToken(teamId)`; root keeps `ownerToken`.
5. Forms and API keys per team (join, constraints, api-keys). Old root codes keep working.
6. Access request: "לקוח חדש? בקש גישה" on the sign-in screen and on the "not allowed" screen. Google sign-in gives the email; the form asks business name + WhatsApp (05X check). Public POST through `api/forms.ts?fn=access`, rate-limited per IP and email, Resend mail to the owner.
7. Owner, "מי יכול להיכנס": pending requests with אשר (max managers: 1 / 10 / 30) / דחה. Approve creates `team:<email>`; audit-logged.
8. Customer team owner, "מי יכול להיכנס": add/remove his managers up to his limit; a manager of a customer team cannot manage the list. Shali for them: free only.
9. Delete account / disconnect Drive per team (`deleteAccount.ts` today wipes root keys only).
10. Tests per step, e2e on the fake Drive for the request screen, translations, security review of the diff, merge.

## Security review before code (security-expert)

Trust boundaries crossed: a public form (spam, enumeration), new OAuth mode storing other people's Drive refresh tokens, and the tenant boundary itself (a customer must never get the root token or another team's keys). Review questions:
- Can any request choose its `teamId`? (It must always come from the session or the sealed code/key record, never from the body or URL.)
- Does every existing route that reads a global key get the team check, including ones added later? (Plan: a test lists every `KEYS.*` use in `api/_lib/routes/` and fails on an unscoped one.)
- Removing a customer: sessions of all his managers end, his Drive tokens are revoked.

## Risks

- Missing one route = a customer reads the root team's data. Covered by the test above plus a negative test per route (customer session -> root data refused).
- Vercel Hobby forbids commercial use: before the first outside paying customer, Vercel Pro (the user's open debt).
- Google OAuth verification: customers granting Drive to an unverified app see a warning screen (open debt: store-apps item 3).

## Size

About as big as part 1. Two sessions.
