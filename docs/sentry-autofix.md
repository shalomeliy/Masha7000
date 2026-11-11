# Fixing new errors from Sentry (scheduled, owner approves)

A scheduled Claude Code task on the owner's PC (`fix-sentry-errors`, every 4 hours from 08:00 to 22:00,
only while the Claude app is open) reads the live app's new errors and, for each real bug, opens a pull
request with the fix. Nothing reaches the live site until the owner merges the pull request on GitHub
(Vercel deploys `master`; each pull request also gets its own Vercel preview link to try first).

## Setup (done once by the owner)

- Sentry org `artpeace`, EU region, project Browser JavaScript, error monitoring only.
- Read-only token in `.env.local`: `SENTRY_AUTH_TOKEN=` (Sentry > User Settings > Personal Tokens,
  Read on Project, Issue & Event, Organization). `.env.local` is never committed.
- Errors carry the Vercel commit as their release (`vite.config.ts` define `VITE_RELEASE`), so
  `scripts/sentry-issues.mjs --resolve` can rebuild that exact commit and map minified positions back
  to source lines. Errors from before 2026-11-11 have no release and stay minified.

## One run

1. `node scripts/sentry-issues.mjs --resolve` lists errors not handled yet. No new errors: stop, say nothing.
2. For each error: read the mapped source lines and the last steps, find the cause. Skip (and mark
   handled, with the reason in the run's summary) anything that is not this app's bug: browser
   extensions, ad blockers, network drops, `ResizeObserver loop`, old cached builds.
3. A real bug: work in a separate git worktree outside the shared checkout, on branch
   `fix/sentry-<id>` from `origin/master`. Fix it with the smallest change, add a test that fails without
   the fix when it can be tested, run `npm run verify`. Never touch `.env.local`, never call the
   Anthropic API, never push to `master`, never merge.
4. Push the branch, open a pull request, assign `shalomeliy` and request his review. The body starts with a
   Hebrew explanation a non-programmer understands: what broke, for whom, what changed, and how to check
   it on the Vercel preview link. Then the Sentry link.
5. `node scripts/sentry-issues.mjs --mark <id>` for every error handled or skipped, then remove the worktree.

## The scheduled task's prompt

Created in the Claude app (Scheduled tasks) as `fix-sentry-errors`, cron `0 8-22/4 * * *`. Prompt: "Project
C:\Users\Shalom\Projects\Masha7000. Read CLAUDE.md and docs/sentry-autofix.md and do one run exactly as the
'One run' section says. The folder is shared with other sessions: never git checkout, switch, stash, reset
or add -A in it; fixes go in a git worktree under %TEMP% with a node_modules junction to the project's.
PR body starts with the attribution lines
`<!-- claude-projects-attribution: {"github_login":"shalomeliy"} -->` and `_Requested by **בוס**_`. New UI text
through tx() in all 14 locale files, translated by you. End with a short Hebrew summary: new errors, fix PR
links, skipped ones and why."
