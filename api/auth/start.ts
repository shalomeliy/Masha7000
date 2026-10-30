import { randomToken, seal, sha256url } from '../_lib/crypto.js'
import { readEnv } from '../_lib/env.js'
import { authUrl, type Mode } from '../_lib/google.js'
import { guarded, redirect, setCookie, STATE_COOKIE } from '../_lib/http.js'

// GET /api/auth/start[?mode=owner]: the whole page goes to Google. The state and PKCE verifier
// wait in a sealed 10-minute cookie, checked when Google sends the browser back.

export const GET = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return redirect('/?signin=not-configured')
  const url = new URL(req.url)
  const mode: Mode = url.searchParams.get('mode') === 'owner' ? 'owner' : 'identity'
  const state = randomToken(16)
  const verifier = randomToken(32)
  const cookie = setCookie(STATE_COOKIE, await seal(env.sessionKey, { state, verifier, mode, at: Date.now() }), 600)
  return redirect(authUrl(env, mode, state, await sha256url(verifier), url.searchParams.get('hint') ?? undefined), [cookie])
})
