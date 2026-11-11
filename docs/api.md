# Masha7000 API (v1)

The outside API lets another system read and write the app's data: workers, shifts, jobs waiting to be scheduled, and the lists they use. Everything is JSON.

Base URL: `https://masha7000.vercel.app/api/v1`

## Keys

The app owner creates keys in the app: Settings > נתונים וגוגל > גישת API.

- Every request sends the key: `Authorization: Bearer m7k_...`
- A key can be **read only** or **read and write**.
- Workers' personal details (ID number, personal number, birth date, address, phones, notes) and every free-text note (constraint notes, job notes, closure notes) are sent only with a key made with **"כולל פרטים אישיים"**. Other keys never get them.
- The key is shown once, when it is created. A revoked key stops working at once.
- Limit: 60 calls a minute per key.

## Answers

Every answer is one JSON object with `schemaVersion` (now `1`):

```json
{ "schemaVersion": 1, "data": [ ... ] }
{ "schemaVersion": 1, "data": { ... }, "warnings": ["worker w1 is also in shift s1 on 2026-11-02"] }
{ "schemaVersion": 1, "error": { "code": "invalid", "message": "date: must be a date, YYYY-MM-DD", "field": "date" } }
```

Dates are `YYYY-MM-DD`, times `HH:mm`, moments ISO 8601. Ids are strings. `GET /schema` returns the JSON Schema of every shape below. A change that breaks it raises `schemaVersion`.

| Status | code | Meaning |
|---|---|---|
| 401 | `bad-key` | no key, a wrong key, or a revoked key |
| 403 | `no-scope` | a read-only key tried to write |
| 404 | `not-found` | no such path or id |
| 405 | `bad-method` | only GET, POST, PATCH |
| 409 | `conflict` | the data changed while the call ran (someone saved in the app). Nothing was written. Try again |
| 409 | `open-app-first` | the app must be opened once to update its shift files |
| 409 | `owner-disconnected` | the owner disconnected the app from Google Drive |
| 409 | `too-many-constraints` | a worker already has 200 constraints; remove old ones in the app |
| 413 | `too-big` | body over 32 KB |
| 422 | `invalid` | a field is wrong; `field` names it |
| 429 | `too-many` | over the limit |
| 502 | `google-failed` | Google Drive did not answer. Try again |

## Read (any key)

| Request | Returns |
|---|---|
| `GET /workers` | active and sick workers. `?includeInactive=true` adds inactive ones |
| `GET /workers/<id>` | one worker |
| `GET /shifts?from=2026-11-01&to=2026-11-30` | shifts starting in that range, both days included, at most 366 days |
| `GET /shifts/<id>` | one shift |
| `GET /pending-jobs` | jobs waiting to be scheduled. `?waiting=true`: only those not yet put into a shift |
| `GET /certifications` | certifications |
| `GET /shift-kinds` | job templates (day, night...) |
| `GET /departments` | departments |
| `GET /work-kinds` | kinds of work |
| `GET /schema` | the JSON Schema |

### Worker

```json
{
  "id": "w1", "firstName": "אבי", "lastName": "כהן",
  "status": "active", "sickUntil": null, "departmentId": "d1",
  "certifications": [{ "id": "c1", "stars": 3, "validUntil": "2027-01-01" }],
  "constraints": [{ "id": "k1", "kind": "vacation", "when": "dates", "from": "2026-11-20", "to": "2026-11-21", "weekdays": [], "nightsOnly": false, "part": null }],
  "personal": { "idNumber": "...", "personalNumber": null, "birthDate": null, "address": "...", "mobilePhone": "...", "homePhone": null, "emergencyPhones": [], "notes": null }
}
```

`status`: `active`, `sick` (with `sickUntil`), `inactive`. `stars`: 0-5. `personal` and each constraint's `note`: only with a personal key. Constraint `when`: `dates` (from-to), `weekdays` (`weekdays`, 0 = Sunday, optional from-to), `always` (nights only). `kind`: `vacation`, `study`, `reserve`, `course`, `sick`, or null. `part`: `morning`, `noon`, `evening`, or null for the whole day.

### Shift

```json
{
  "id": "s1", "date": "2026-11-02", "shiftKindId": "day", "location": "דימונה", "jobDescription": "כבלים",
  "crew": ["w1"], "pinnedWorkerIds": [], "staffing": [{ "certificationIds": ["c1"], "workKindId": null }],
  "workKindIds": [], "urgent": false, "startTime": null, "endDate": null, "endTime": null,
  "fromPendingJobId": null, "nextJob": null,
  "closure": null
}
```

`staffing`: one place per person; `certificationIds` the person must hold, empty = any worker. `closure` (night jobs that ended): `outcome` `done` / `partial` / `postponed`, `note`, `reasonIds`, `closedAt`.

### Pending job

```json
{ "id": "j1", "location": "ערד 17", "jobDescription": "החלפת אנטנה", "shiftKindId": null, "staffing": [], "workKindIds": [], "pinnedWorkerIds": [], "createdAt": "2026-11-11T08:00:00.000Z", "fromShiftId": null, "scheduledShiftId": null, "outcome": null, "note": null }
```

## Write (read-and-write key)

Fields not listed are refused (422), so a typo is never ignored. Nothing can be deleted through the API.

| Request | Body | Returns |
|---|---|---|
| `POST /shifts` | `date` (required), `location` and/or `jobDescription` (one is required), `shiftKindId`, `crew` (worker ids), `pinnedWorkerIds` (must be in the crew), `staffing` | 201, the shift |
| `PATCH /shifts/<id>` | any of the fields above | the shift |
| `POST /pending-jobs` | `location` and/or `jobDescription`, `shiftKindId`, `staffing`, `pinnedWorkerIds`, `note` | 201, the job |
| `PATCH /workers/<id>` | `status` (`sick` needs `sickUntil`), `departmentId`, `certifications`: the full list `[{ "id", "stars"?, "validUntil"? }]` | the worker |
| `POST /workers/<id>/constraints` | `when` (default `dates`), `from`, `to`, `weekdays`, `nightsOnly`, `part`, `kind`, `note` | 201, the constraint |

Rules, the same as in the app:

- An inactive worker cannot be put in a crew. The same worker twice is refused.
- A worker already in another job that day, a worker marked sick, or a worker without a place's certifications is **written** and comes back in `warnings`.
- A crew change on a saved shift is recorded as a swap, so the app's archive shows it.
- A certification new to the worker starts with 0 stars unless `stars` is sent.
- Closing a night job is done in the app only (it also opens the follow-up jobs).

When the app is open while the API writes, the app sees it as someone else's save and reloads before its own next save.

## Examples

```bash
KEY=m7k_...
curl -s -H "Authorization: Bearer $KEY" "https://masha7000.vercel.app/api/v1/shifts?from=2026-11-01&to=2026-11-30"

curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"location":"ערד 17","jobDescription":"החלפת אנטנה"}' \
  https://masha7000.vercel.app/api/v1/pending-jobs
```
