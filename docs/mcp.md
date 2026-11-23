# Masha7000 MCP server

Lets Claude Code on the owner's PC answer questions about the shift calendar ("מי פנוי מחר?", "מה יש ביומן השבוע?", "מי בחופש?") from the live app, and, with a write key, add and change things ("תוסיף עבודה בחולון מחר בלילה עם יותם ומנחם"). Code: `mcp/server.mjs` (reading, protocol) and `mcp/write.mjs` (changes); tests: `mcp/server.test.ts`, `mcp/write.test.ts`. Spike and live test: `docs/spikes/mcp-server.md`.

## Reading

| Tool | Answers |
|---|---|
| `today` | today's date in Israel and the next 14 days with weekday names (so "מחר", "שלישי" become dates) |
| `get_shifts` | jobs between two dates: id, kind, place, job, crew names, needs per place, how many missing |
| `who_is_free` | free (with certifications still valid that day), partly free (night-only or part-of-day limits), not free and why |
| `get_workers` | active workers: status, department, certifications with stars and expiry, constraints in words |
| `get_pending_jobs` | jobs waiting for a date |

## Changing (added 2026-11-23, the owner's request)

| Tool | Does | API call |
|---|---|---|
| `add_shift` | a new job on a date: place, job, kind, crew by name, optional needs per place | `POST shifts` |
| `update_shift` | change a job (id from `get_shifts`): date, place, job, kind, add/remove crew or a whole new crew | `PATCH shifts/:id` |
| `add_pending_job` | a job to the waiting list | `POST pending-jobs` |
| `set_worker_status` | sick until a date, back to active, or not active | `PATCH workers/:id` |
| `add_constraint` | dates, fixed weekdays or always; kind (חופש, מחלה, מילואים...), nights only or part of the day | `POST workers/:id/constraints` |

Nothing can be deleted: the API has no delete, and the client refuses any method but GET, POST and PATCH.

**The approval rule (the owner's, 2026-11-23).** Before any change Claude reads the whole change back in Hebrew and writes only after the manager explicitly approved it. If he corrects anything, Claude reads the whole updated change back again, until he approves it. How the code holds Claude to it:

1. A write tool called without `confirm: true` writes nothing. It returns `readBack` (the change in Hebrew), `warnings` (sick, already in another job that day, a constraint that day, a job he is in while marked sick or away) and a `changeCode`.
2. `confirm: true` writes only with the `changeCode` of that exact change. Any difference (another worker, another date) gives another code, so the write is refused and Claude has to read the new change back first.
3. The rule is in the server's `instructions` and in every write tool's description. Claude Code also asks before each tool call, unless the owner allowed that tool for good.

Names, not ids: workers, shift kinds and certifications are found by name (full name, or a first name only one worker has). A name that fits nobody or two workers is refused with the candidates, so Claude asks the manager which one. The API's own warnings come back in Hebrew with names.

## Keys

- Reading: a key **without** personal details and **without** write.
- Changing: a key **with write**, still without personal details. With a read-only key the change tools still show the read-back, and the write itself is refused with "המפתח הזה מותר רק לקריאה".

## Setup (once, on the owner's PC)

1. App: Settings > נתונים וגוגל > גישת API > new key. Personal details: no. Write: yes only if changes through Claude are wanted.
2. PowerShell: `setx MASHA_API_KEY <the key>`, then close Claude completely and open it again. A new key replaces the old one the same way.
3. `.mcp.json` in the repo already registers the server. Open a new Claude Code session in the Masha7000 folder and approve the `masha7000` server when asked.

The new Claude desktop chat does not read `claude_desktop_config.json`, so the server works in Claude Code only.

## Changing it

- The API shape is `api/_lib/v1/contract.ts`, the write endpoints and their checks are in `api/v1.ts`. If they change, update `mcp/` and its tests together.
- Tests use a fake API only. Never test writes against the live data.
- No dependencies on purpose: MCP over stdio is newline-delimited JSON-RPC 2.0.
