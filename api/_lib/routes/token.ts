import { teamToken } from '../drive.js'
import { missingEnv, readEnv } from '../env.js'
import { clientIp, guarded, json, readJson, sameOrigin } from '../http.js'
import { overLimit } from '../rate.js'
import { requireManager, whoIs } from '../session.js'

// POST /api/token: a 1-hour access token for the Drive folder and calendar of the caller's team (the
// owner's for the root team, the customer's own for a customer team; api/_lib/team.ts),
// for anyone signed in, still allowed and two-step verified. Cached so Google is asked about once an hour.

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured', missing: missingEnv() }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  if (await overLimit(env, 'token', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  const { session, team } = gate
  const who = await whoIs(env, session.email, team)

  // stale: Google already refused the cached token (access removed), so ask Google again.
  const stale = (await readJson(req))?.stale === true
  const got = await teamToken(env, team.id, stale)
  if ('reason' in got) return json({ reason: got.reason, ...(got.reason === 'owner-disconnected' ? who : {}) }, got.reason === 'owner-disconnected' ? 409 : 502)
  return json({ accessToken: got.token, expiresIn: got.expiresIn, ...who })
})
