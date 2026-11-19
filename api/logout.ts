import { audit } from './_lib/audit.js'
import { deleteAccount } from './_lib/deleteAccount.js'
import { readEnv } from './_lib/env.js'
import { clearCookie, guarded, json, readJson, sameOrigin, SESSION_COOKIE } from './_lib/http.js'
import { endSession, readSession, requireManager } from './_lib/session.js'

// POST /api/logout: signs out this device only (its session is deleted on the server too).
// Other devices and the owner's Drive link stay.
// POST /api/logout { action: 'delete-account' }: deletes the account of whoever asks, verified with
// two-step like every manager action (api/_lib/deleteAccount.ts). Here and not in a new file: the
// plan allows 12 function files (api/_lib/functionCount.test.ts).

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  const body = await readJson(req)
  if (body?.action === 'delete-account') {
    const gate = await requireManager(env, req)
    if ('refuse' in gate) return gate.refuse
    await audit(env, req, 'account-delete', { email: gate.session.email })
    await deleteAccount(env, gate.session.email)
    return json({ ok: true }, 200, [clearCookie(SESSION_COOKIE)])
  }
  const session = await readSession(env, req)
  if (session) await endSession(env, session)
  return json({ ok: true }, 200, [clearCookie(SESSION_COOKIE)])
})
