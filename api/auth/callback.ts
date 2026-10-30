import { open, seal } from '../_lib/crypto.js'
import { readEnv } from '../_lib/env.js'
import { emailOf, exchangeCode, hasOwnerScopes, type Mode } from '../_lib/google.js'
import { clearCookie, guarded, readCookie, redirect, STATE_COOKIE } from '../_lib/http.js'
import { KEYS, kv } from '../_lib/kv.js'
import { isAllowed, isOwner, sessionCookie } from '../_lib/session.js'

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

  const pending = await open<Pending>(env.sessionKey, readCookie(req, STATE_COOKIE))
  const state = url.searchParams.get('state')
  if (!pending || !state || pending.state !== state || Date.now() - pending.at > 600_000) return fail('failed')
  if (url.searchParams.get('error')) return fail('cancelled')
  const code = url.searchParams.get('code')
  if (!code) return fail('failed')

  const { ok, data } = await exchangeCode(env, code, pending.verifier)
  const email = ok ? emailOf(data.id_token) : null
  if (!email) return fail('failed')

  if (pending.mode === 'owner') {
    if (!isOwner(env, email)) return fail('not-owner')
    if (!data.refresh_token) return fail('failed')
    // Google lets the owner untick Drive or Calendar; without both the shared data cannot work.
    if (!hasOwnerScopes(data.scope)) return fail('scopes')
    await kv.set(env, KEYS.refresh, await seal(env.sessionKey, data.refresh_token))
    await kv.del(env, KEYS.access)
  } else {
    if (!(await isAllowed(env, email))) return fail('not-allowed')
    if (isOwner(env, email) && !(await kv.get(env, KEYS.refresh))) {
      return redirect('/api/auth/start?mode=owner', [clearState, await sessionCookie(env, email)])
    }
  }
  return redirect('/', [clearState, await sessionCookie(env, email)])
})
