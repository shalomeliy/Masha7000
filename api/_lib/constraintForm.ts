// The weekly constraints form's rules, no I/O: who is on the roster, and what an answer may hold.
// The form itself is api/constraints.ts.

/** A worker the form knows: the manager's app sends these when it opens the form. */
export interface RosterEntry {
  id: string
  firstName: string
  phone: string // digits only, local form: 0501234567
}

export interface ConstraintAnswer {
  id: string
  at: number
  workerId: string
  weekStart: string
  days: string[] // 7 answers, Sunday first; '' = can work that day
  notes?: string
}

export const MAX_ROSTER = 500
const MAX_DAY = 120
const MAX_NOTES = 500

/** Digits of a phone, in local form: "+972-50-123 4567" -> "0501234567". */
export const phoneDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '').replace(/^972/, '0')

export const isMobileDigits = (d: string) => /^05\d{8}$/.test(d)

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

/** A Sunday, as the week's first day. */
export const isWeekStart = (s: unknown): s is string => isDate(s) && new Date(`${s}T00:00:00Z`).getUTCDay() === 0

/** The roster as it will be stored: valid mobiles only, one worker per phone, names cut short. */
export function cleanRoster(raw: unknown): RosterEntry[] {
  const seen = new Set<string>()
  const out: RosterEntry[] = []
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r.id !== 'string' || typeof r.firstName !== 'string') continue
    const phone = phoneDigits(r.phone)
    if (!isMobileDigits(phone) || seen.has(phone)) continue
    seen.add(phone)
    out.push({ id: r.id.slice(0, 64), firstName: r.firstName.trim().slice(0, 40), phone })
    if (out.length >= MAX_ROSTER) break
  }
  return out
}

/** The worker's 7 day answers and notes, cut to length; null when the shape is wrong. */
export function cleanAnswer(raw: { days?: unknown; notes?: unknown }): { days: string[]; notes?: string } | null {
  if (!Array.isArray(raw.days) || raw.days.length !== 7) return null
  const days = raw.days.map((d) => (typeof d === 'string' ? d.replace(/\s+/g, ' ').trim().slice(0, MAX_DAY) : ''))
  const notes = typeof raw.notes === 'string' ? raw.notes.trim().slice(0, MAX_NOTES) : ''
  return notes ? { days, notes } : { days }
}
