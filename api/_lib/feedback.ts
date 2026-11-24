// A manager's request for a new feature, sent by email to the app's maker through Resend
// (free tier: 100 mails a day). The key and the recipient stay on the server; the app only
// sends the text. Without a verified domain Resend sends only to the address its account was
// opened with, so the account must be opened with the recipient's address.

export const FEEDBACK_TO_DEFAULT = 'shalom.eliy@gmail.com'
export const FEEDBACK_MAX = 4000

/** The request's text, trimmed; null when empty or too long. */
export function feedbackText(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim() : ''
  return text && text.length <= FEEDBACK_MAX ? text : null
}

export interface FeedbackMail {
  from: string
  to: string[]
  reply_to: string
  subject: string
  text: string
}

/** Plain text only, so nothing the manager wrote can turn into markup in the mail. */
export function feedbackMail(text: string, sender: string, to: string, from: string, when = new Date()): FeedbackMail {
  const first = text.split('\n')[0].slice(0, 60)
  return {
    from,
    to: [to],
    reply_to: sender,
    subject: `Shali - בקשת תכונה: ${first}`,
    text: `${text}\n\n---\nנשלח מהאפליקציה על ידי ${sender}\n${when.toISOString()}`,
  }
}

/** Sends through Resend's REST API. True when it was accepted. Never logs the key or the text. */
export async function sendFeedback(apiKey: string, mail: FeedbackMail, fetcher: typeof fetch = fetch): Promise<boolean> {
  const res = await fetcher('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(mail),
  })
  if (!res.ok) console.error('feedback mail refused', res.status)
  return res.ok
}

// ---- Fault reports (2026-11-23) ----
// A manager reports something broken. It goes to a dedicated address kept only on the server
// (FAULT_REPORT_EMAIL in Vercel), so the users never see where it lands.

export interface FaultDetails {
  urgent: boolean
  where: string
  page: string
  device: string
  model: string
  os: string
  osVersion: string
  occurredAt: string
  language: string
  release: string
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '')

/** The details the app adds by itself, each cut short and flattened to one line. */
export function faultDetails(raw: unknown): FaultDetails {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    urgent: r.urgent === true,
    where: clip(r.where, 80),
    page: clip(r.page, 200),
    device: clip(r.device, 300),
    model: clip(r.model, 80),
    os: clip(r.os, 40),
    osVersion: clip(r.osVersion, 40),
    occurredAt: clip(r.occurredAt, 40),
    language: clip(r.language, 20),
    release: clip(r.release, 60),
  }
}

/** The recipient of fault reports: the dedicated address, else the feature-request one. */
export function faultRecipient(env: Record<string, string | undefined> = process.env): string {
  return (env.FAULT_REPORT_EMAIL ?? '').trim() || (env.FEEDBACK_TO ?? '').trim() || FEEDBACK_TO_DEFAULT
}

export function faultMail(text: string, d: FaultDetails, sender: string, to: string, from: string, when = new Date()): FeedbackMail {
  const first = text.split('\n')[0].slice(0, 60)
  const lines = [
    `דחיפות: ${d.urgent ? 'דחוף, אי אפשר לעבוד' : 'רגיל'}`,
    d.where && `איפה באפליקציה: ${d.where}`,
    d.page && `כתובת: ${d.page}`,
    d.occurredAt && `מתי קרתה: ${d.occurredAt}`,
    d.model && `מכשיר: ${d.model}`,
    (d.os || d.osVersion) && `מערכת הפעלה: ${[d.os, d.osVersion].filter(Boolean).join(' ')}`,
    d.device && `דפדפן (טכני): ${d.device}`,
    d.language && `שפה: ${d.language}`,
    d.release && `גרסה: ${d.release}`,
    `מדווח: ${sender}`,
    `זמן: ${when.toISOString()}`,
  ].filter(Boolean)
  return {
    from,
    to: [to],
    reply_to: sender,
    subject: `Shali - ${d.urgent ? 'תקלה דחופה' : 'דיווח תקלה'}: ${first}`,
    text: `${text}\n\n---\n${lines.join('\n')}`,
  }
}

/** The urgent-fault WhatsApp number (FAULT_WHATSAPP), as digits with the country code; '' when unset. */
export function faultWhatsapp(env: Record<string, string | undefined> = process.env): string {
  let d = (env.FAULT_WHATSAPP ?? '').replace(/\D/g, '')
  if (d.startsWith('0')) d = `972${d.slice(1)}` // an Israeli number written as 05x
  return d.length >= 9 && d.length <= 15 ? d : ''
}
