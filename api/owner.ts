import { open } from './_lib/crypto.js'
import { readEnv } from './_lib/env.js'
import { revoke } from './_lib/google.js'
import { guarded, json, sameOrigin } from './_lib/http.js'
import { KEYS, kv } from './_lib/kv.js'
import { isOwner, normalizeEmail, readSession } from './_lib/session.js'

// POST /api/owner { action }: the owner's controls. 'list' | 'add' | 'remove' manage who may sign in
// (the owner is implicit and never stored); 'disconnect' revokes the app's access to the owner's Drive.

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  const session = await readSession(env, req)
  if (!session) return json({ reason: 'no-session' }, 401)
  if (!isOwner(env, session.email)) return json({ reason: 'not-owner' }, 403)

  const body = (await req.json().catch(() => ({}))) as { action?: string; email?: unknown }
  if (body.action === 'disconnect') {
    const refresh = await open<string>(env.sessionKey, await kv.get(env, KEYS.refresh))
    if (refresh) await revoke(refresh)
    await kv.del(env, KEYS.refresh, KEYS.access)
    return json({ ok: true })
  }
  if (body.action === 'add' || body.action === 'remove') {
    const email = normalizeEmail(body.email)
    if (!email) return json({ reason: 'bad-email' }, 400)
    if (email === env.ownerEmail) return json({ reason: 'owner-implicit' }, 400)
    if (body.action === 'add') await kv.add(env, KEYS.allowed, email)
    else await kv.remove(env, KEYS.allowed, email)
  } else if (body.action !== 'list') {
    return json({ reason: 'bad-action' }, 400)
  }
  const emails = (await kv.members(env, KEYS.allowed)).sort()
  return json({ owner: env.ownerEmail, emails })
})
