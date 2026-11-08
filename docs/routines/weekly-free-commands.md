# Weekly routine: make repeated voice requests free

Schedule: every Sunday 09:00, in the Claude desktop app (Scheduled tasks), folder `C:\Users\Shalom\Projects\Masha7000`.
Needs `CLAUDE_LOG_TOKEN` (32+ characters) in Vercel env and in `.env.local`, or it has no log to read.

Prompt to paste:

---

Work in the project folder C:\Users\Shalom\Projects\Masha7000 (git repo, branch master). Read its CLAUDE.md and HANDOFF.md first and follow them.

Goal: make the voice assistant cheaper. Requests that went to Claude (paid) more than once should become free local code.

1. `git pull origin master`. Commit only your own files; leave other changes untouched.
2. Read the log: `node scripts/claude-log.mjs --last 200`. If CLAUDE_LOG_TOKEN is missing or the server refuses, change nothing and say so in one Hebrew line.
3. Run the project skill `free-commands`. Do its "Always look for a cheaper way" list first, then a new action type. Only shapes that appear at least twice in the log, at most the two most frequent per run.
4. Never call Anthropic or use the real API key; tests use the stand-in only. New texts shown in every language go through tx() and are translated by you into all 15 languages. Zero wrong actions in the "must still go to Claude" tests.
5. `npm run verify` must pass. Update HANDOFF.md ("free voice commands"), commit and `git push origin master`.
6. If nothing repeated, change nothing.

End with a short summary in simple Hebrew: what became free this week (or nothing), and how to check it on the voice assistant screen.
