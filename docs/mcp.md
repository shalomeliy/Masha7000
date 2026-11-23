# Masha7000 MCP server (read only)

Lets Claude Code on the owner's PC answer questions about the shift calendar ("מי פנוי מחר?", "מה יש ביומן השבוע?", "מי בחופש?") from the live app. Code: `mcp/server.mjs`, tests: `mcp/server.test.ts`. Spike and live test: `docs/spikes/mcp-server.md`.

## What it can do

| Tool | Answers |
|---|---|
| `today` | today's date in Israel and the next 14 days with weekday names (so "מחר", "שלישי" become dates) |
| `get_shifts` | jobs between two dates: kind, place, job, crew names, needs per place, how many missing |
| `who_is_free` | free (with certifications still valid that day), partly free (night-only or part-of-day limits), not free and why |
| `get_workers` | active workers: status, department, certifications with stars and expiry, constraints in words |
| `get_pending_jobs` | jobs waiting for a date |

It only sends GET to `/api/v1`, so nothing in the app can change through it. Use a key **without** personal details and **without** write: no phones or ID numbers reach Claude.

## Setup (once, on the owner's PC)

1. App: Settings > נתונים וגוגל > גישת API > new key, both boxes empty.
2. `cmd`: `setx MASHA_API_KEY <the key>`, then close Claude completely and open it again.
3. `.mcp.json` in the repo already registers the server. Open a new Claude Code session in the Masha7000 folder and approve the `masha7000` server when asked.

The new Claude desktop chat does not read `claude_desktop_config.json`, so the server works in Claude Code only.

## Changing it

- The API shape is `api/_lib/v1/contract.ts`. If it changes, update `mcp/server.mjs` and its tests together.
- Keep it read only. Write tools would need the owner's decision first (a key with write, and a confirm before each change).
- No dependencies on purpose: MCP over stdio is newline-delimited JSON-RPC 2.0.
