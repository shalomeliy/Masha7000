import { apiKeysAction } from './_lib/apiKeysRoute.js'
import { open } from './_lib/crypto.js'
import { readEnv } from './_lib/env.js'
import { revoke } from './_lib/google.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { KEYS, kv } from './_lib/kv.js'
import { overLimit } from './_lib/rate.js'
import { endAllSessions, isOwner, normalizeEmail, requireManager } from './_lib/session.js'

// POST /api/owner { action }: the owner's controls. 'list' | 'add' | 'remove' manage who may sign in
// (the owner is implicit and never stored); 'disconnect' revokes the app's access to the owner's Drive.
// POST /api/owner?scope=api-keys { action }: the outside-API keys (api/_lib/apiKeysRoute.ts), same owner-only checks.

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  const keys = new URL(req.url).searchParams.get('scope') === 'api-keys'
  if (await overLimit(env, keys ? 'apiKeysManage' : 'owner', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  if (!isOwner(env, gate.session.email)) return json({ reason: 'not-owner' }, 403)

  const body = await readJson(req)
  if (!body) return json({ reason: keys ? 'bad-request' : 'bad-body' }, 400)
  if (keys) return apiKeysAction(env, body)
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
    else {
      // Out of the list: signed out everywhere now, and a fresh two-step setup if ever added back.
      await kv.remove(env, KEYS.allowed, email)
      await endAllSessions(env, email)
      await kv.del(env, KEYS.mfa(email), KEYS.mfaSetup(email))
    }
  } else if (body.action !== 'list') {
    return json({ reason: 'bad-action' }, 400)
  }
  const emails = (await kv.members(env, KEYS.allowed)).sort()
  return json({ owner: env.ownerEmail, emails })
})
