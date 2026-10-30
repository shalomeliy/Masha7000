import { readEnv } from './_lib/env.js'
import { clearCookie, guarded, json, sameOrigin, SESSION_COOKIE } from './_lib/http.js'

// POST /api/logout: signs out this device only. Other devices and the owner's Drive link stay.

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  return json({ ok: true }, 200, [clearCookie(SESSION_COOKIE)])
})
