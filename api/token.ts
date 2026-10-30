import { open, seal } from './_lib/crypto.js'
import { missingEnv, readEnv } from './_lib/env.js'
import { refreshAccess } from './_lib/google.js'
import { guarded, json, sameOrigin } from './_lib/http.js'
import { KEYS, kv } from './_lib/kv.js'
import { isAllowed, isOwner, readSession } from './_lib/session.js'

// POST /api/token: a 1-hour access token for the owner's Drive folder and calendar,
// for anyone signed in and still allowed. Cached so Google is asked about once an hour.

interface Cached {
  token: string
  exp: number
}

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured', missing: missingEnv() }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  const session = await readSession(env, req)
  if (!session) return json({ reason: 'no-session' }, 401)
  if (!(await isAllowed(env, session.email))) return json({ reason: 'not-allowed' }, 403)
  const who = { email: session.email, isOwner: isOwner(env, session.email) }

  // stale: Google already refused the cached token (access removed), so ask Google again.
  const { stale } = (await req.json().catch(() => ({}))) as { stale?: boolean }
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
