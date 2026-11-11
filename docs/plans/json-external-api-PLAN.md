# Plan: documented JSON contract and external API (read + write)

Spec: `docs/specs/json-external-api.md` (approved 2026-11-11). Spike: `docs/spikes/json-external-api.md` (GO).
`SECURITY TRIGGERED`: `security-expert` reviews this plan and the built diff.

## 1. Current architecture

- Data: JSON files in the owner's Drive appDataFolder (`DRIVE_FILES`, `src/lib/google/config.ts`); shifts one file per month (`src/lib/data/shiftMonths.ts`). Shapes in `src/types/models.ts`, old shapes upgraded on read (`normalizeWorker` in `src/lib/catalog.ts`, `normalizeConstraint` in `src/lib/constraints.ts`).
- The browser reads and writes Drive itself (`src/lib/google/drive.ts`), with a version + md5 check that throws `ConflictError` when someone else changed a file.
- The server holds the owner's sealed refresh token and a cached access token in the store (`api/token.ts`, `api/_lib/kv.ts`). The spike proved the server can read the month files in under 1 s.
- `/api` is cookie + two-step only (`requireManager`). No outside access exists.
- `api/` builds with `module: nodenext` (imports end in `.js`) and does not import from `src/`.

## 2. Thin slice

Owner creates a read key in Settings, then `curl -H "Authorization: Bearer <key>" https://masha7000.vercel.app/api/v1/shifts?from=2026-11-01&to=2026-11-30` returns the month's shifts as clean JSON with `schemaVersion: 1`. Everything else builds on that.

## 3. Files

Server, new:

- `api/_lib/drive.ts`: server-side Drive: `ownerToken(env)` (moved from `api/token.ts`, which then uses it), `listFiles(prefix)`, `readFile(name)` returning `{ id, version, md5, body }`, `writeFile(name, body, expected)` that re-reads version + md5 just before the PATCH and refuses with `conflict` when the content changed (same rule and same small window as the browser).
- `api/_lib/apiKeys.ts`: key = `m7k_` + 32 random bytes base64url. Stored: `apikey:<sha256>` = sealed `{ id, name, scopes: ('read'|'write')[], personal: boolean, createdAt }`, plus set `apikeys` of ids for the list and `apikey-used:<id>` = last use time. `checkKey(req)` = hash of the bearer, constant-time compare not needed (lookup by hash). Revoke deletes the record at once.
- `api/_lib/v1/contract.ts`: the outside shapes (`ApiWorker`, `ApiShift`, `ApiPendingJob`, `ApiCertification`, `ApiConstraint`) and `toApi*` functions from the stored shapes. Old fields (`roleId`, `certificationId`) never leave. Personal fields (`idNumber`, `personalNumber`, `address`, `birthDate`, all phones) only when the key has `personal: true`.
- `api/_lib/v1/normalize.ts`: the small part of `normalizeWorker` / `normalizeConstraint` / `slotCerts` the server needs, copied (api cannot import `src/`). A test runs both copies on the same fixtures so they cannot drift.
- `api/_lib/v1/validate.ts`: body checks for writes: required fields, dates `YYYY-MM-DD`, ids that exist (worker, certification, shift kind), size limits. Double-booking and missing certification are returned as `warnings`, not refusals, as in the app (manager rule 2026-11-07).
- `api/v1/[...path].ts`: one function, a small router (if Vercel does not route a catch-all file outside Next, fall back to a rewrite `/api/v1/(.*)` -> `/api/v1?path=$1` in `vercel.json`; checked first in step 3): `GET workers | workers/<id> | shifts?from&to | pending-jobs | certifications | schema`, `POST shifts | pending-jobs | workers/<id>/constraints`, `PATCH shifts/<id> | workers/<id>`. Order in each request: key -> rate limit per key -> scope -> handler. No CORS headers (server-to-server use; a browser page elsewhere cannot call it, by design for now).
- `api/v1/schema.json` content generated as a constant in `contract.ts` (hand-written JSON Schema, checked by a test against sample `toApi*` output).
- `api/_lib/apiLog.ts`: last 500 calls in the store: key id, method, path, status, time. No bodies.
- `api/api-keys.ts`: owner only (`requireManager` + `isOwner`, same-origin): `list`, `create { name, scopes, personal }` (answers the key once), `revoke { id }`, `log`.
- `api/_lib/rate.ts`: add `apiKey: { max: 60, windowSeconds: 60 }`.

Client:

- `src/pages/settings/ApiSection.tsx`: Settings > "גישת API" (owner only): list of keys (name, rights, personal yes/no, last use), "מפתח חדש" (name, read / read+write, "כולל פרטים אישיים" with a warning), the key shown once with a copy button, revoke with a confirm, and the recent calls log. Every text through `tx()` and translated into all 15 languages.
- `docs/api.md`: how to call, every route with an example request and answer, error codes. Linked from the Settings screen.

## 4. API and failure behavior

- Every answer: `{ schemaVersion: 1, data }` or `{ schemaVersion: 1, error: { code, message } }`.
- `401 no-key | bad-key`, `403 no-scope`, `404 not-found`, `409 conflict` (file changed during the write: the caller retries), `409 owner-disconnected`, `413 too-big`, `422 invalid` (with the field), `429 too-many`, `502 google-failed`, `503 not-configured`.
- Writes: `POST` creates with a new id (same id format as the app), answers the created record. `PATCH` takes only the fields it allows (shift: date, location, jobDescription, crew, staffing, closure; worker: status, sickUntil, certificationIds, certRatings, certExpiry, departmentId). No deletes.
- A write by the API changes the Drive file, so an open app screen meets `ConflictError` on its next save and asks to reload. Existing behavior, accepted.
- Shifts written to the month of their date via the same month-file rule as `shiftMonths.ts` (a moved shift is written to its new month first).
- The API never calls Anthropic, so `spendGuard` is untouched.

## 5. UI state

`ApiSection` uses TanStack Query on `/api/api-keys` (`list`, `log`); create and revoke are mutations that refetch. The new key lives only in component state until the dialog closes.

## 6. Tests (Vitest, the existing `server.test.ts` fakes for Google and the store)

- Keys: create, hash only stored, revoke works at once, wrong key 401, read key writing 403.
- Personal fields absent on every route without `personal`, present with it.
- `shifts?from&to` returns exactly the shifts in range across two month files.
- Write: create pending job, patch a shift, conflict when the file changed between read and write gives 409 and writes nothing.
- Validation: bad date 422, unknown worker 422, double booking gives a warning and still writes.
- Rate limit 429 on call 61.
- Normalizer copies agree with `src/lib` on shared fixtures.
- Schema test: sample output matches the JSON Schema.

## 7. Risks, rollback, non-goals

- Risk: an outside key leaks. Limits: hash-only storage, revoke at once, read-only keys by default, personal data off by default, rate limit, call log.
- Risk: server and app rules drift. Limit: the cross-check test on the copied normalizers; writes keep rules small (shape + ids + warnings).
- Risk: an outside writer and the app save at once. Same conflict check as two managers today.
- Rollback: the API is one function folder plus one Settings screen; removing `api/v1/` and the section turns it off. Revoking all keys turns it off without a deploy.
- Non-goals: deletes, webhooks, worker access, CORS for browser pages, moving off Drive.

## 8. Steps (each ends with its tests passing, then `npm run verify`)

1. `api/_lib/drive.ts` (move `ownerToken` out of `api/token.ts`, add read/list/write with the check) + tests.
2. `apiKeys.ts`, `api-keys.ts`, rate bucket, call log + tests.
3. `contract.ts`, `normalize.ts`, read routes (`workers`, `shifts`, `pending-jobs`, `certifications`, `schema`) + tests. Thin slice works here.
4. `validate.ts` and write routes + tests.
5. `ApiSection.tsx` in Settings, all strings in 15 languages.
6. `docs/api.md`. `security-expert` + `change-reviewer` on the diff. Merge to master, owner creates a key and runs one read and one write from the curl examples.
