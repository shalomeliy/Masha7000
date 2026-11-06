import { open, seal } from './_lib/crypto.js'
import { missingEnv, readEnv } from './_lib/env.js'
import { refreshAccess } from './_lib/google.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { KEYS, kv } from './_lib/kv.js'
import { overLimit } from './_lib/rate.js'
import { isOwner, requireManager } from './_lib/session.js'

// POST /api/token: a 1-hour access token for the owner's Drive folder and calendar,
// for anyone signed in, still allowed and two-step verified. Cached so Google is asked about once an hour.

interface Cached {
  token: string
  exp: number
}

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured', missing: missingEnv() }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  if (await overLimit(env, 'token', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  const { session } = gate
  const who = { email: session.email, isOwner: isOwner(env, session.email) }

  // stale: Google already refused the cached token (access removed), so ask Google again.
  const stale = (await readJson(req))?.stale === true
  const cached = stale ? null : await open<Cached>(env.sessionKey, await kv.get(env, KEYS.access))
  if (cached && cached.exp - Date.now() > 120_000) {
    return json({ accessToken: cached.token, expiresIn: Math.floor((cached.exp - Date.now()) / 1000), ...who })
  }

  const refresh = await open<string>(env.sessionKey, await kv.get(env, KEYS.refresh))
  if (!refresh) return json({ reason: 'owner-disconnected', ...who }, 409)
  const { ok, data } = await refreshAccess(env, refresh)
  if (!ok || !data.access_token) {
    if (data.error === 'invalid_grant') {
      // The owner removed the app's access in Google, or the token expired: everyone needs the owner to reconnect.
      await kv.del(env, KEYS.refresh, KEYS.access)
      return json({ reason: 'owner-disconnected', ...who }, 409)
    }
    return json({ reason: 'google-failed' }, 502)
  }
  const expiresIn = data.expires_in ?? 3600
  const exp = Date.now() + expiresIn * 1000
  await kv.set(env, KEYS.access, await seal(env.sessionKey, { token: data.access_token, exp } satisfies Cached), expiresIn - 60)
  return json({ accessToken: data.access_token, expiresIn, ...who })
})
