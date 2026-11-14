import { readEnv } from './_lib/env.js'
import { FEEDBACK_TO_DEFAULT, feedbackMail, feedbackText, sendFeedback } from './_lib/feedback.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { overLimit } from './_lib/rate.js'
import { requireManager } from './_lib/session.js'

// POST /api/feedback { text }: a signed-in manager's request for a new feature, emailed to the
// app's maker. The recipient address and the mail key never reach the browser.

export const POST = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  if (!sameOrigin(req, env.appOrigin)) return json({ reason: 'bad-origin' }, 403)
  if (await overLimit(env, 'feedbackIp', clientIp(req))) return json({ reason: 'too-many' }, 429)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  if (await overLimit(env, 'feedbackEmail', gate.session.email)) return json({ reason: 'too-many' }, 429)
  const apiKey = (process.env.RESEND_API_KEY ?? '').trim()
  if (!apiKey) return json({ reason: 'no-key' }, 503)

  const body = await readJson(req, 20_000)
  const text = feedbackText(body?.text)
  if (!text) return json({ reason: 'bad-body' }, 400)
  const to = (process.env.FEEDBACK_TO ?? '').trim() || FEEDBACK_TO_DEFAULT
  const from = (process.env.FEEDBACK_FROM ?? '').trim() || 'Shali <onboarding@resend.dev>'
  const sent = await sendFeedback(apiKey, feedbackMail(text, gate.session.email, to, from))
  return sent ? json({ ok: true }) : json({ reason: 'send-failed' }, 502)
})
