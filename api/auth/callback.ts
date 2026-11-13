import { audit } from '../_lib/audit.js'
import { open, seal } from '../_lib/crypto.js'
import { readEnv } from '../_lib/env.js'
import { emailOf, exchangeCode, hasOwnerScopes, type Mode } from '../_lib/google.js'
import { clearCookie, clientIp, guarded, readCookie, redirect, STATE_COOKIE } from '../_lib/http.js'
import { overLimit } from '../_lib/rate.js'
import { KEYS, kv } from '../_lib/kv.js'
import { createSession, endSession, hasMfa, isAllowed, isOwner, readSession } from '../_lib/session.js'

// GET /api/auth/callback: Google sends the browser back here with a code.
// Identity sign-in: an allowed email gets a session. The owner, the very first time (before setting up
// two-step), is sent on to grant Drive access. Owner sign-in: the refresh token is stored sealed.
// Once the owner has two-step, linking Drive again (after a disconnect too) needs a verified device:
// someone with only the Google password cannot point the app at a Drive of their choosing.

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
    if (!isOwner(env, email)) {
      await audit(env, req, 'signin-refused', { email, target: 'drive' })
      return fail('not-owner')
    }
    // Linking Drive needs a two-step verified device, except the very first link, which comes
    // straight after the owner's first sign-in, before two-step is set up.
    const linked = (await kv.get(env, KEYS.refresh)) !== null
    const sameVerified = current?.email === email && current.mfa
    if ((linked || (await hasMfa(env, email))) && !sameVerified) {
      await audit(env, req, 'signin-refused', { email, target: 'drive' })
      return fail('failed')
    }
    if (!data.refresh_token) return fail('failed')
    // Google lets the owner untick Drive or Calendar; without both the shared data cannot work.
    if (!hasOwnerScopes(data.scope)) return fail('scopes')
    await kv.set(env, KEYS.refresh, await seal(env.sessionKey, data.refresh_token))
    await kv.del(env, KEYS.access)
    await audit(env, req, 'drive-connect', { email })
    // Keep the owner's own device session (and its two-step check) when there is one.
    if (current?.email === email) return redirect('/', [clearState])
    if (current) await endSession(env, current)
    return redirect('/', [clearState, await createSession(env, email)])
  }
  if (!(await isAllowed(env, email))) {
    await audit(env, req, 'signin-refused', { email })
    return fail('not-allowed')
  }
  // A new sign-in on this device replaces the old one, which ends on the server too.
  if (current) await endSession(env, current)
  const cookie = await createSession(env, email)
  await audit(env, req, 'signin', { email })
  // With two-step set up, the owner first types a code; the app then offers to link Drive again.
  if (isOwner(env, email) && !(await kv.get(env, KEYS.refresh)) && !(await hasMfa(env, email))) {
    return redirect('/api/auth/start?mode=owner', [clearState, cookie])
  }
  return redirect('/', [clearState, cookie])
})
