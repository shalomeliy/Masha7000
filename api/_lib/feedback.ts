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
    subject: `Shaly - בקשת תכונה: ${first}`,
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
