import { addToLog, clearStoredLog, logEntry, readLog, tokenMatches } from './_lib/claudeLog.js'
import { readEnv, type Env } from './_lib/env.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { overLimit } from './_lib/rate.js'
import { isOwner, requireManager } from './_lib/session.js'

// The "what went to Claude" log of the voice assistant (api/_lib/claudeLog.ts). Owner only, like the
// assistant itself.
// POST { entry }: add one conversation, or update it (same id).
// GET: the whole log, oldest first. Also open to a development session with the CLAUDE_LOG_TOKEN key
//   (scripts/claude-log.mjs), so the log can be read without pasting.
// DELETE: empty it.

async function ownerGate(req: Request, env: Env): Promise<Response | null> {
  if (req.method !== 'GET' && !sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  if (!isOwner(env, gate.session.email)) return json({ reason: 'not-owner' }, 403)
  return null
}

async function start(req: Request): Promise<{ env: Env } | { refuse: Response }> {
  const env = readEnv()
  if (!env) return { refuse: json({ reason: 'not-configured' }, 503) }
  if (await overLimit(env, 'claudeLog', clientIp(req))) return { refuse: json({ reason: 'too-many' }, 429) }
  return { env }
}

export const GET = guarded(async (req: Request) => {
  const s = await start(req)
  if ('refuse' in s) return s.refuse
  if (!tokenMatches(req)) {
    const refused = await ownerGate(req, s.env)
    if (refused) return refused
  }
  return json({ entries: await readLog(s.env) })
})

export const POST = guarded(async (req: Request) => {
  const s = await start(req)
  if ('refuse' in s) return s.refuse
  const refused = await ownerGate(req, s.env)
  if (refused) return refused
  const entry = logEntry((await readJson(req, 30_000))?.entry)
  if (!entry) return json({ reason: 'bad-body' }, 400)
  await addToLog(s.env, entry)
  return json({ ok: true })
})

export const DELETE = guarded(async (req: Request) => {
  const s = await start(req)
  if ('refuse' in s) return s.refuse
  const refused = await ownerGate(req, s.env)
  if (refused) return refused
  await clearStoredLog(s.env)
  return json({ ok: true })
})
