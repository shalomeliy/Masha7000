import { readEnv } from './_lib/env.js'
import { FEEDBACK_TO_DEFAULT, faultDetails, faultMail, faultRecipient, faultWhatsapp, feedbackMail, feedbackText, sendFeedback } from './_lib/feedback.js'
import { clientIp, guarded, json, readJson, sameOrigin } from './_lib/http.js'
import { overLimit } from './_lib/rate.js'
import { requireManager } from './_lib/session.js'

// POST /api/feedback { text }: a signed-in manager's request for a new feature, emailed to the
// app's maker. With { kind: 'fault', text, details } it is a fault report, emailed to the
// dedicated FAULT_REPORT_EMAIL. The recipient addresses and the mail key never reach the browser.
// (One function for both: the Vercel plan allows 12 function files.)

// GET /api/feedback: the WhatsApp number for urgent faults (FAULT_WHATSAPP), signed-in managers only.
// The number shows on the urgent button anyway (WhatsApp opens a chat with it); it lives in Vercel so
// it can change without a new version.
export const GET = guarded(async (req: Request) => {
  const env = readEnv()
  if (!env) return json({ reason: 'not-configured' }, 503)
  const gate = await requireManager(env, req)
  if ('refuse' in gate) return gate.refuse
  return json({ whatsapp: faultWhatsapp() })
})

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
  const from = (process.env.FEEDBACK_FROM ?? '').trim() || 'Shali <onboarding@resend.dev>'
  const mail =
    body?.kind === 'fault'
      ? faultMail(text, faultDetails(body.details), gate.session.email, faultRecipient(), from)
      : feedbackMail(text, gate.session.email, (process.env.FEEDBACK_TO ?? '').trim() || FEEDBACK_TO_DEFAULT, from)
  const sent = await sendFeedback(apiKey, mail)
  return sent ? json({ ok: true }) : json({ reason: 'send-failed' }, 502)
})
