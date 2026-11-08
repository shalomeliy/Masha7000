import { tx } from '../i18n'
import type { Worker } from '../types/models'

// The workers' details form: one link the manager sends to the WhatsApp group. Workers fill it
// without signing in; answers wait on the server until a manager adds them to the workers list.

export interface Tag {
  id: string
  name: string
}
export interface FormLists {
  certifications: Tag[]
  departments: Tag[]
}

/** What a worker fills in. The server keeps only these fields. */
export interface JoinDetails {
  firstName: string
  lastName: string
  mobilePhone: string
  idNumber?: string
  personalNumber?: string
  birthDate?: string
  address?: string
  homePhone?: string
  emergencyPhone1?: string
  emergencyPhone2?: string
  departmentId?: string
  certificationIds: string[]
  notes?: string
}
export interface Submission extends JoinDetails {
  id: string
  at: number
}

export const joinUrl = (code: string, origin = window.location.origin) => `${origin}/join/${code}`

/** The form's code when this page is the form (/join/<code>), else null. */
export const joinCodeOf = (pathname: string) => /^\/join\/([\w-]{8,64})\/?$/.exec(pathname)?.[1] ?? null

export const joinMessage = (url: string) =>
  tx('שלום לכולם, כדי שיהיו לי הפרטים המעודכנים של כל אחד, נא למלא את הטופס הקצר בקישור (שתי דקות):\n{url}', { url })

const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '').replace(/^972/, '0')

/** The worker already on the list that this answer is about: same ID number, else same mobile. */
export function matchWorker(sub: JoinDetails, workers: Worker[]): Worker | undefined {
  const id = digits(sub.idNumber)
  const phone = digits(sub.mobilePhone)
  return (id && workers.find((w) => digits(w.idNumber) === id)) || (phone ? workers.find((w) => digits(w.mobilePhone) === phone) : undefined)
}

const FIELDS = [
  'firstName',
  'lastName',
  'mobilePhone',
  'idNumber',
  'personalNumber',
  'birthDate',
  'address',
  'homePhone',
  'emergencyPhone1',
  'emergencyPhone2',
  'departmentId',
] as const

/**
 * The worker the manager will review before saving: a new worker from the answer, or the existing one
 * with the answer's filled fields written over theirs. Certifications are added, never removed;
 * notes are appended.
 */
export function workerFromSubmission(sub: JoinDetails, existing: Worker | undefined, newId: () => string): Worker {
  const base: Worker = existing ?? { id: newId(), firstName: '', lastName: '', certificationIds: [], constraints: [], status: 'active' }
  const next: Worker = { ...base, certificationIds: [...new Set([...base.certificationIds, ...sub.certificationIds])] }
  for (const f of FIELDS) if (sub[f]?.trim()) next[f] = sub[f]!.trim()
  if (sub.notes?.trim()) next.notes = [base.notes?.trim(), sub.notes.trim()].filter(Boolean).join('\n')
  return next
}

/** The lists the form offers: the manager's departments and certifications. */
export const formLists = (certifications: Tag[], departments: Tag[]): FormLists => ({
  certifications: certifications.map(({ id, name }) => ({ id, name })),
  departments: departments.map(({ id, name }) => ({ id, name })),
})

const REASONS: Record<string, string> = {
  closed: tx('הטופס הזה כבר סגור. בקש מהמנהל קישור חדש.'),
  already: tx('כבר שלחת את הפרטים שלך, ואי אפשר לשלוח שוב. אם צריך לתקן משהו, פנה למנהל.'),
  name: tx('צריך למלא שם פרטי ושם משפחה.'),
  mobile: tx('הטלפון הנייד לא תקין. צריך 10 ספרות שמתחילות ב-05.'),
  id: tx('תעודת הזהות לא תקינה. צריך 9 ספרות.'),
  full: tx('יש כרגע יותר מדי טפסים שממתינים למנהל. נסה שוב מחר.'),
  'no-session': tx('החיבור במכשיר הזה נגמר. צריך להתחבר שוב.'),
  'not-allowed': tx('אין לך הרשאה לזה.'),
  'not-configured': tx('הטופס עובד רק באתר החי.'),
}

async function call<T>(init: RequestInit, query = ''): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/join${query}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...init })
  } catch {
    throw new Error(tx('אין חיבור לאינטרנט. נסה שוב.'))
  }
  const data = (await res.json().catch(() => ({}))) as T & { reason?: string }
  if (!res.ok) throw new Error(REASONS[data.reason ?? ''] ?? tx('משהו השתבש. נסה שוב בעוד רגע.'))
  return data
}
const post = <T>(body: object) => call<T>({ method: 'POST', body: JSON.stringify(body) })

export const readForm = (code: string) => call<{ lists: FormLists }>({ method: 'GET' }, `?c=${encodeURIComponent(code)}`)
export const submitForm = (code: string, details: JoinDetails) => post<{ ok: true }>({ action: 'submit', code, details })
export const openForm = (lists: FormLists, renew = false) => post<{ code: string }>({ action: 'open', lists, renew })
export const closeForm = () => post<{ code: null }>({ action: 'close' })
export const listSubmissions = () => post<{ code: string | null; submissions: Submission[] }>({ action: 'list' })
/** allowAgain: the answer was thrown away, so this person may fill the form again. */
export const removeSubmission = (id: string, allowAgain = false) => post<{ ok: true }>({ action: 'remove', id, allowAgain })

// This phone already sent an answer: the form opens on "already sent" (the server refuses a second one anyway).
const sentKey = (code: string) => `shiftsmart.joined.${code}`
export function markSent(code: string) {
  try {
    localStorage.setItem(sentKey(code), '1')
  } catch {
    // Storage blocked: the server still refuses a second answer.
  }
}
export function wasSent(code: string) {
  try {
    return localStorage.getItem(sentKey(code)) === '1'
  } catch {
    return false
  }
}
