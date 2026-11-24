import { hasRequest, requestMail, storeRequest, cleanRequest } from '../accessRequests.js'
import { audit } from '../audit.js'
import { open } from '../crypto.js'
import { readEnv, type Env } from '../env.js'
import { FEEDBACK_TO_DEFAULT, sendFeedback } from '../feedback.js'
import { APPLY_COOKIE, APPLY_SECONDS, clientIp, guarded, json, readCookie, readJson, sameOrigin } from '../http.js'
import { overLimit } from '../rate.js'

// "לקוח חדש? בקש גישה" (api/_lib/accessRequests.ts). Public, but only right after a Google sign-in
// that found the email in no team: the sign-in callback left that email, verified by Google, in a
// sealed 30-minute cookie. The email is never taken from the request.
// GET  /api/access                       -> { email } (or { email: null }: sign in with Google first), sent
// POST /api/access { businessName, whatsapp } -> { ok }  the same answer for every email

async function applicant(env: Env, req: Request): Promise<string | null> {
  const c = await open<{ email?: unknown; at?: unknown }>(env.sessionKey, readCookie(req, APPLY_COOKIE))
  if (!c || typeof c.email !== 'string' || typeof c.at !== 'number' || Date.now() - c.at > APPLY_SECONDS * 1000) return null
  return c.email
}

export const GET = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (await overLimit(env, 'accessIp', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const email = await applicant(env, req)
  return json({ email, sent: email ? await hasRequest(env, email) : false })
})

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  if (await overLimit(env, 'accessIp', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const email = await applicant(env, req)
  if (!email) return json({ reason: 'no-applicant' }, 401)
  if (await overLimit(env, 'accessEmail', email)) return json({ reason: 'too-many' }, 429)
  const body = await readJson(req, 2_000)
  if (!body) return json({ reason: 'bad-body' }, 400)
  const cleaned = cleanRequest(body)
  if ('reason' in cleaned) return json({ reason: cleaned.reason }, 400)
  if ((await storeRequest(env, email, cleaned)) === 'stored') {
    await audit(env, req, 'access-request', { email })
    const apiKey = (process.env.RESEND_API_KEY ?? '').trim()
    if (apiKey) {
      const from = (process.env.FEEDBACK_FROM ?? '').trim() || 'Shali <onboarding@resend.dev>'
      const to = (process.env.FEEDBACK_TO ?? '').trim() || FEEDBACK_TO_DEFAULT
      await sendFeedback(apiKey, requestMail({ email, ...cleaned, at: new Date().toISOString() }, to, from)).catch(() => false)
    }
  }
  return json({ ok: true })
})
