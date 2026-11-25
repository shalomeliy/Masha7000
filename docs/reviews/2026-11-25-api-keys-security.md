# Security review: outside-API keys for customer teams (2026-11-25)

Scope: `api/v1.ts`, `api/_lib/apiKeys.ts`, `api/_lib/apiKeysRoute.ts`, `api/_lib/routes/owner.ts` (scope=api-keys), `api/_lib/team.ts`, `api/_lib/drive.ts` (`teamToken`), tests `api/_lib/v1.test.ts`, `api/_lib/tenancy.test.ts`. The question: can a customer's key reach anyone else's data, and can a key keep working when it should not?

## Checked and holding

| Attack | Why it fails | Test |
|---|---|---|
| A customer key reads the owner's Drive (or another customer's) | The team comes from the key's sealed record (`seal` with `SESSION_KEY`); a caller cannot write or change a record. `teamToken(teamId)` opens only that team's refresh token | tenancy: "API keys: each team its own list, its own Drive" |
| A customer lists or revokes another team's key by id | `records()` keeps only records whose own `teamId` is the caller's team; the team comes from `requireManager`, never the body | same test (revoke root key: `ok: false`) |
| A customer manager (not the team owner) makes keys | `owner.ts`: `isTeamOwner` required | owner route tests |
| A key keeps working after the team is removed or its owner deletes the account | `revokeTeamKeys` on removal; `v1.ts` also refuses a key whose team record is gone | tenancy: "the owner removes a customer" |
| Guessing keys | 32 random bytes, looked up by SHA-256 only; wrong keys limited per address (30 / 10 min) | v1: "refuses no key, a wrong key", "stores only the hash" |
| A read key writes | `scopes` checked before anything else | v1: "a read key cannot write" |
| A browser page uses a stolen session to call the API | No cookies, no CORS headers: the API takes only `Authorization: Bearer` | by design |
| Reaching files outside the app | Drive calls are `spaces=appDataFolder` only | by design |
| Personal fields (ID number, phones, address) leak | Only with a key made with `personal`, chosen by that team's owner for his own workers | v1: "personal fields only with a personal key" |

## Found and fixed in this change

1. **A hidden key that still works.** A customer turns "גישת API" on, makes keys, then turns the feature off in Settings > מסכים ותכונות. The screen with the keys disappears, but the keys kept opening his Drive, and he could no longer see or revoke them. Fix: `api/v1.ts` reads the team's `settings.json` and answers `403 api-off` while the feature is off (`api/_lib/v1/features.ts`, kept equal to `resolveFeatures` by `src/lib/apiNormalize.test.ts`). Nothing is deleted: turning it on brings the same keys back. The owner's team has no onboarding record, so it is always on (unchanged).
2. **No limit per team.** Each key had 60 calls a minute, and a team may hold 20 keys: 1,200 calls a minute on one Drive and on our Vercel functions. Fix: `apiTeam` limit, 300 a minute for all the keys of one team together.

Cost of fix 1: one more small Drive read (`settings.json`) per call.

## Left open (not bugs now)

- When the 7-day trial ends (next stage), a team whose trial ran out must have its keys refused the same way. Add it to the trial plan.
- Bad-key calls are logged in the root team's log (no team is known for a wrong key). Fine: it is the owner's.

Verdict: customer API keys are safe to offer, with the two fixes above.
