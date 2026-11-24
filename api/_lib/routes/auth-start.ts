import { randomToken, seal, sha256url } from '../crypto.js'
import { readEnv } from '../env.js'
import { authUrl, type Mode } from '../google.js'
import { clientIp, guarded, redirect, setCookie, STATE_COOKIE } from '../http.js'
import { overLimit } from '../rate.js'
import { readSession } from '../session.js'
import { teamOf } from '../team.js'

// GET /api/auth/start[?mode=owner|team]: the whole page goes to Google. mode=team (a customer team
// owner links his own Drive) only from his own two-step verified session: the team and his email
// are sealed into the state from the server's records, never taken from the request. The state and PKCE verifier
// wait in a sealed 10-minute cookie, checked when Google sends the browser back.

export const GET = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return redirect('/?signin=not-configured')
  if (await overLimit(env, 'signIn', clientIp(req))) return redirect('/?signin=too-many')
  const url = new URL(req.url)
  const asked = url.searchParams.get('mode')
  const mode: Mode = asked === 'owner' ? 'owner' : asked === 'team' ? 'team' : 'identity'
  let team: { teamId: string; email: string } | null = null
  if (mode === 'team') {
    const session = await readSession(env, req)
    const t = session?.mfa ? await teamOf(env, session.email) : null
    if (!session || !t || t.isRoot || !t.isTeamOwner) return redirect('/?signin=failed')
    team = { teamId: t.id, email: session.email }
  }
  const state = randomToken(16)
  const verifier = randomToken(32)
  const cookie = setCookie(STATE_COOKIE, await seal(env.sessionKey, { state, verifier, mode, at: Date.now(), ...(team ?? {}) }), 600)
  const hint = team ? team.email : (url.searchParams.get('hint')?.slice(0, 254) ?? undefined)
  return redirect(authUrl(env, mode, state, await sha256url(verifier), hint), [cookie])
})
