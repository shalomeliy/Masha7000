# Spike: MCP server over the outside API (/api/v1)

Date: 2026-11-23. Spike code was in `spikes/mcp/`; the full build replaced it with `mcp/server.mjs` (see docs/mcp.md).

## Question

Can Claude (Desktop or Code) read the Masha7000 calendar through a small MCP server that only wraps the existing `/api/v1`, with no new server code and no way to change data?

## What was built

- A stdio MCP server with no dependencies (newline JSON-RPC 2.0), ~150 lines.
- 5 read-only tools: `get_shifts(from, to)`, `get_workers`, `get_pending_jobs`, `get_lists` (id to name), `who_is_free(date)`.
- `who_is_free` is computed in the server: skips inactive, sick on that day, already in a job that day (including multi-day jobs), whole-day constraints (dates, weekdays, always). Night-only or part-of-day constraints go to "partly free".
- Only `GET` requests, with `Authorization: Bearer <key>`. A key without personal details is enough: no phones or ID numbers reach Claude.

## Evidence

- `node spikes/mcp/try.mjs` (fake API on a local port): 7 of 7 PASS. initialize, tools/list, who_is_free (sick, busy, vacation excluded; night-only = partly), get_shifts, bad date = tool error, unknown tool refused, only GET with the key.
- The official `@modelcontextprotocol/sdk` client (the same library Claude Desktop uses) connected over stdio, listed the 5 tools and called one. An unreachable API came back as a tool error, not a crash.
- Live test 2026-11-23 on the owner's PC (key without personal details, from the MASHA_API_KEY user env var): initialize, tools/list, who_is_free for 2026-11-24 (8 free, 6 not free: 2 sick, 1 vacation, 3 in a job) and get_shifts for the week (1 job) all succeeded against the real API.
- Claude Desktop's chat no longer reads claude_desktop_config.json in the new app; the server is registered for Claude Code through `.mcp.json` (key via `${MASHA_API_KEY}`).

## Verdict: GO (live test passed 2026-11-23)

The riskiest part (protocol, tool shape, read-only, no personal data) works. The API already has everything the tools need, including constraints inside workers.

## What a full build would add (not started)

- Move from `spikes/` to a real place (`mcp/`), with Vitest tests instead of `try.mjs`.
- Constraint `part` (morning/noon/evening) shown by name, shift kinds by name.
- Maybe write tools later (create a job) through the existing write endpoints, each behind a confirm. Only if the owner asks.
- Optional: remote MCP endpoint on Vercel (`/api/mcp`) so Claude on the phone can use it, instead of a local process.

## How the owner tests it (Claude Desktop, Windows)

1. Settings > נתונים וגוגל > גישת API: make a key **without** personal details.
2. Claude Desktop > Settings > Developer > Edit Config, add:

```json
{
  "mcpServers": {
    "masha7000": {
      "command": "node",
      "args": ["C:\\Users\\Shalom\\Projects\\Masha7000\\spikes\\mcp\\server.mjs"],
      "env": { "MASHA_API_KEY": "<the key>" }
    }
  }
}
```

3. Restart Claude Desktop and ask: "מי פנוי מחר?" or "מה יש ביומן השבוע?".
