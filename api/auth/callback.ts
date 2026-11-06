import { open, seal } from '../_lib/crypto.js'
import { readEnv } from '../_lib/env.js'
import { emailOf, exchangeCode, hasOwnerScopes, type Mode } from '../_lib/google.js'
import { clearCookie, clientIp, guarded, readCookie, redirect, STATE_COOKIE } from '../_lib/http.js'
import { overLimit } from '../_lib/rate.js'
import { KEYS, kv } from '../_lib/kv.js'
import { createSession, endSession, isAllowed, isOwner, readSession } from '../_lib/session.js'

// GET /api/auth/callback: Google sends the browser back here with a code.
// Identity sign-in: an allowed email gets a session. The owner, the first time (or after a
// disconnect), is sent on to grant Drive access. Owner sign-in: the refresh token is stored sealed.

interface Pending {
  state: string
  verifier: string
  mode: Mode
  at: number
}

export const GET = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return redirect('/?signin=not-configured')
  const url = new URL(req.url)
  const clearState = clearCookie(STATE_COOKIE)
  const fail = (why: string) => redirect(`/?signin=${why}`, [clearState])

  if (await overLimit(env, 'signIn', clientIp(req))) return fail('too-many')
  const pending = await open<Pending>(env.sessionKey, readCookie(req, STATE_COOKIE))
  const state = url.searchParams.get('state')
  if (!pending || !state || pending.state !== state || Date.now() - pending.at > 600_000) return fail('failed')
  if (url.searchParams.get('error')) return fail('cancelled')
  const code = url.searchParams.get('code')
  if (!code) return fail('failed')

  const { ok, data } = await exchangeCode(env, code, pending.verifier)
  const email = ok ? emailOf(data.id_token) : null
  if (!email) return fail('failed')

  const current = await readSession(env, req)
  if (pending.mode === 'owner') {
    if (!isOwner(env, email)) return fail('not-owner')
    // Replacing a working Drive link needs a two-step verified device; the first link (or after a
    // disconnect) comes straight after the owner's first sign-in, before any code.
    const linked = (await kv.get(env, KEYS.refresh)) !== null
    const sameVerified = current?.email === email && current.mfa
    if (linked && !sameVerified) return fail('failed')
    if (!data.refresh_token) return fail('failed')
    // Google lets the owner untick Drive or Calendar; without both the shared data cannot work.
    if (!hasOwnerScopes(data.scope)) return fail('scopes')
    await kv.set(env, KEYS.refresh, await seal(env.sessionKey, data.refresh_token))
    await kv.del(env, KEYS.access)
    // Keep the owner's own device session (and its two-step check) when there is one.
    if (current?.email === email) return redirect('/', [clearState])
    return redirect('/', [clearState, await createSession(env, email)])
  }
  if (!(await isAllowed(env, email))) return fail('not-allowed')
  // A new sign-in on this device replaces the old one, which ends on the server too.
  if (current) await endSession(env, current)
  const cookie = await createSession(env, email)
  if (isOwner(env, email) && !(await kv.get(env, KEYS.refresh))) {
    return redirect('/api/auth/start?mode=owner', [clearState, cookie])
  }
  return redirect('/', [clearState, cookie])
})
