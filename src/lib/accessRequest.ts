import { tx } from '../i18n'

// "לקוח חדש? בקש גישה" (smart onboarding part 2). The server knows the email from the Google
// sign-in that was just refused (api/_lib/routes/access.ts); here the person adds a business name
// and a WhatsApp number.

export interface Applicant {
  /** The Google-verified email, or null: sign in with Google first. */
  email: string | null
  /** A request from this email already waits for the owner. */
  sent: boolean
}

/** A WhatsApp number the server takes: an Israeli mobile, 05X and 7 more digits. */
export const isWhatsapp = (raw: string) => /^05\d{8}$/.test(raw.replace(/\D/g, '').replace(/^972/, '0'))

export async function loadApplicant(): Promise<Applicant> {
  try {
    const res = await fetch('/api/access', { credentials: 'same-origin' })
    if (!res.ok) return { email: null, sent: false }
    const body = (await res.json()) as Partial<Applicant>
    return { email: typeof body.email === 'string' ? body.email : null, sent: body.sent === true }
  } catch {
    return { email: null, sent: false }
  }
}

const REASONS: Record<string, string> = {
  name: tx('צריך שם עסק.'),
  whatsapp: tx('מספר וואטסאפ צריך להיות נייד, 05X.'),
  'no-applicant': tx('עבר יותר מדי זמן מההתחברות. התחבר שוב עם Google ונסה שוב.'),
  'too-many': tx('יותר מדי בקשות. נסה שוב מחר.'),
}

export async function sendAccessRequest(businessName: string, whatsapp: string): Promise<void> {
  let res: Response
  try {
    res = await fetch('/api/access', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessName, whatsapp }),
    })
  } catch {
    throw new Error(tx('אין חיבור לאינטרנט.'))
  }
  if (res.ok) return
  const reason = ((await res.json().catch(() => ({}))) as { reason?: string }).reason ?? ''
  throw new Error(REASONS[reason] ?? tx('השרת לא הצליח. נסה שוב.'))
}
