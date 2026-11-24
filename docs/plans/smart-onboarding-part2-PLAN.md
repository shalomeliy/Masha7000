# Plan: smart onboarding, stage 1 part 2 (customers on their own Drive)

Status: security review done (2026-11-24), changes below folded in; building. Part 1 (features on/off, wizard, guide, Shali) is built.

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

## Changes after the security review (2026-11-24)

- One email belongs to one team only. Root (owner + `allowed`) wins; approving a root email, adding a root email to a customer team, or adding a customer's email to root is refused. `teamOf` null = refuse, never root.
- Team ids are random (`tm_...`), never an email. `member:<email>` and `team-owner:<email>` point to the id; the team keeps a member set so removal finds every member.
- teamId is resolved from the store on every request (`requireManager`), never kept in the session record, never read from a body, query or cookie.
- `teamToken` works only on `t:<id>:*` keys and refuses root; `ownerToken` stays the only path to `owner:refresh`.
- OAuth `mode=team`: auth start accepts it only from a verified session of a customer team owner and seals `{ mode, teamId }`; the callback re-reads the team, requires the Google email = the team owner, never OWNER_EMAIL, both scopes, and writes only `t:<id>:refresh`.
- Customer managers are managed by their own actions with their own gate (never the root `add`/`remove`). Removing one ends all his sessions and forgets his two-step.
- Free-only Shali for customers is enforced in code: no Claude, no cloud voice (TTS) and no server speech-to-text (they spend the owner's monthly caps) until the owner turns on "גם Claude" for the team; nothing of a customer goes to the owner's Claude log.
- Public form codes: `formcode:<sha256(code)>` -> sealed `{ teamId }`; "who already sent" is per team (no cross-team phone oracle).
- API keys: the record carries `teamId` (missing = root, so existing keys and the MCP key keep working); list, revoke, cap (20) and log are per team; `/api/v1` opens that team's Drive.
- Access request: the email comes only from a Google sign-in the server sealed in a 30-minute cookie, never typed. One record per email (`areq:<hash>`), same answer for every email, own rate buckets, plain-text mail.
- Deleting a customer owner's account deletes his whole team (Drive token revoked, members signed out, keys gone). The root owner deleting his account touches only root.
- A static test lists every `KEYS.*` use in `api/**/*.ts` against a reviewed list; a negative test per route.
