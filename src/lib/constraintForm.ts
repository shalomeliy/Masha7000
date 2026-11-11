import { tx } from '../i18n'
import type { Worker } from '../types/models'
import { answersToConstraints, mergeReply } from './constraints'
import { isActive, isIsraeliMobile } from './catalog'
import { showDate, addDays } from './shifts'

// The weekly constraints form: one link the manager sends to the WhatsApp group. A worker types
// their mobile number and the days they cannot work; the answer waits on the server until a
// manager's app writes it into that worker's constraints (`applyAnswers`).

export interface ConstraintAnswer {
  id: string
  at: number
  workerId: string
  weekStart: string
  days: string[]
  notes?: string
  /** Sent from another phone than the week's first answer for this worker: waits for the manager. */
  disputed?: boolean
}
export interface RosterEntry {
  id: string
  firstName: string
  phone: string
}
export interface FormState {
  code: string | null
  weekStart: string | null
  answered: string[] // worker ids that answered the open week
  answers: ConstraintAnswer[]
}

export const constraintFormUrl = (code: string, origin = window.location.origin) => `${origin}/constraints/${code}`

/** The form's code when this page is the form (/constraints/<code>), else null. */
export const constraintCodeOf = (pathname: string) => /^\/constraints\/([\w-]{8,64})\/?$/.exec(pathname)?.[1] ?? null

export const constraintFormMessage = (url: string, weekStart: string) =>
  tx('שלום לכולם, נא למלא בקישור באילו ימים אין לכם אפשרות לעבוד בשבוע {v} עד {v2}. ממלאים את מספר הנייד שלכם ושולחים, זה לוקח דקה:\n{url}', {
    v: showDate(weekStart),
    v2: showDate(addDays(weekStart, 6)),
    url,
  })

export type DayPart = 'whole' | 'morning' | 'noon' | 'evening' | 'night'

/** One day on the worker's form: a quick choice, their own words, and "every week". */
export interface DayChoice {
  part?: DayPart
  text: string
  weekly: boolean
}

// What a quick choice sends. Always Hebrew, whatever language the page is shown in: the manager's
// app reads the words back (`readAnswer` in lib/constraints.ts).
const PART_WORDS: Record<DayPart, string> = {
  whole: 'לא יכול כל היום',
  morning: 'לא יכול בבוקר',
  noon: 'לא יכול בצהריים',
  evening: 'לא יכול בערב',
  night: 'בלי לילה',
}

/** One day's answer as the worker means it: "לא יכול בערב, חתונה, כל שבוע"; '' = can work. */
export const dayAnswer = (d: DayChoice) => {
  const words = [d.part ? PART_WORDS[d.part] : '', d.text.trim()].filter(Boolean)
  return words.length ? [...words, ...(d.weekly ? [WEEKLY_WORDS] : [])].join(', ') : ''
}

/** Back from a sent answer to the form's choices, so a reopened form shows what was sent. */
export function dayChoiceOf(answer: string): DayChoice {
  let rest = answer.trim()
  const weekly = rest.endsWith(WEEKLY_WORDS) && rest !== WEEKLY_WORDS
  if (weekly) rest = rest.slice(0, -WEEKLY_WORDS.length).replace(/,\s*$/, '')
  const part = (Object.keys(PART_WORDS) as DayPart[]).find((p) => rest === PART_WORDS[p] || rest.startsWith(`${PART_WORDS[p]}, `))
  if (part) rest = rest.slice(PART_WORDS[part].length).replace(/^,\s*/, '')
  return { ...(part ? { part } : {}), text: rest, weekly }
}
const WEEKLY_WORDS = 'כל שבוע'

const digits = (s: string | undefined) => (s ?? '').replace(/\D/g, '').replace(/^972/, '0')

/** Who the form knows: active workers with a valid mobile, each phone once. */
export const rosterOf = (workers: Worker[]): RosterEntry[] =>
  workers.filter((w) => isActive(w) && isIsraeliMobile(w.mobilePhone)).map((w) => ({ id: w.id, firstName: w.firstName, phone: digits(w.mobilePhone) }))

/** Active workers the form cannot recognize: no mobile, or one that is not valid. */
export const withoutMobile = (workers: Worker[]) => workers.filter((w) => isActive(w) && !isIsraeliMobile(w.mobilePhone))

/** "אילוצים לשבוע 15.11: ...": the notes line of one week's answer, kept in the worker's notes. */
const notesLine = (week: string, notes: string) => `${tx('אילוצים לשבוע {v}:', { v: showDate(week) })} ${notes}`

/**
 * The workers list with the answers written in: each answer replaces what an earlier answer (or
 * pasted reply) for the same week added, and ends weekly ones from earlier weeks (`mergeReply`).
 * The notes line of the same week is replaced, not added twice. Returns the ids of the answers used,
 * including those of workers no longer on the list (nothing to write; they are thrown away).
 */
export function applyAnswers(workers: Worker[], answers: ConstraintAnswer[]): { workers: Worker[]; used: string[] } {
  const next = workers.map((w) => ({ ...w }))
  for (const a of [...answers].sort((x, y) => x.at - y.at)) {
    const w = next.find((x) => x.id === a.workerId)
    if (!w) continue
    w.constraints = mergeReply(w.constraints, answersToConstraints(a.days, a.weekStart), a.weekStart)
    const prefix = tx('אילוצים לשבוע {v}:', { v: showDate(a.weekStart) })
    const kept = (w.notes ?? '').split('\n').filter((l) => l.trim() && !l.startsWith(prefix))
    const notes = [...kept, ...(a.notes?.trim() ? [notesLine(a.weekStart, a.notes.trim())] : [])].join('\n')
    if (notes) w.notes = notes
    else delete w.notes
  }
  return { workers: next, used: answers.map((a) => a.id) }
}

const REASONS: Record<string, string> = {
  closed: tx('הטופס הזה כבר סגור. בקש מהמנהל קישור חדש.'),
  locked: tx('עברו שעתיים מהשליחה הראשונה, אז אי אפשר לתקן יותר. לשינוי פנה למנהל.'),
  'unknown-phone': tx('המספר הזה לא מופיע אצל המנהל. בדוק שכתבת את הנייד שלך כמו שהמנהל מכיר אותו, או פנה למנהל.'),
  'bad-days': tx('משהו השתבש. נסה שוב בעוד רגע.'),
  'bad-week': tx('משהו השתבש. נסה שוב בעוד רגע.'),
  'too-many': tx('יותר מדי ניסיונות. נסה שוב בעוד שעה.'),
  full: tx('יש כרגע יותר מדי תשובות שממתינות למנהל. נסה שוב מחר.'),
  'no-session': tx('החיבור במכשיר הזה נגמר. צריך להתחבר שוב.'),
  'not-allowed': tx('אין לך הרשאה לזה.'),
  'not-configured': tx('הטופס עובד רק באתר החי.'),
}

async function call<T>(init: RequestInit, query = ''): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/constraints${query}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...init })
  } catch {
    throw new Error(tx('אין חיבור לאינטרנט. נסה שוב.'))
  }
  const data = (await res.json().catch(() => ({}))) as T & { reason?: string }
  if (!res.ok) throw new Error(REASONS[data.reason ?? ''] ?? tx('משהו השתבש. נסה שוב בעוד רגע.'))
  return data
}
const post = <T>(body: object) => call<T>({ method: 'POST', body: JSON.stringify(body) })

/** What this phone already sent for the open week, while it keeps the token for it. */
export interface MyAnswer {
  firstName: string
  days: string[]
  notes: string
  until: number // fixing is taken until this moment (ms)
}
export const readConstraintForm = (code: string, token?: string) =>
  call<{ weekStart: string; mine?: MyAnswer }>({ method: 'GET' }, `?c=${encodeURIComponent(code)}${token ? `&t=${encodeURIComponent(token)}` : ''}`)
export const submitConstraints = (code: string, phone: string, days: string[], notes: string, token?: string) =>
  post<{ ok: true; firstName: string; token: string; until: number; review?: boolean }>({ action: 'submit', code, phone, days, notes, token, device: deviceId() })
export const openConstraintForm = (weekStart: string, roster: RosterEntry[], renew = false) => post<{ code: string }>({ action: 'open', weekStart, roster, renew })
export const closeConstraintForm = () => post<{ code: null }>({ action: 'close' })
export const listConstraintAnswers = () => post<FormState>({ action: 'list' })
/** The manager says a disputed answer is the worker's own: it goes into their constraints. */
export const acceptConstraintAnswer = (id: string) => post<{ ok: true }>({ action: 'accept', id })
export const removeConstraintAnswers = (ids: string[]) => post<{ ok: true }>({ action: 'remove', ids })

// The token of the answer this phone sent on this link: opening the link again shows that answer.
const tokenKey = (code: string) => `shiftsmart.consToken.${code}`
export function savedToken(code: string) {
  try {
    return localStorage.getItem(tokenKey(code)) ?? undefined
  } catch {
    return undefined
  }
}
export function saveToken(code: string, token: string) {
  try {
    localStorage.setItem(tokenKey(code), token)
  } catch {
    // Storage blocked: the form opens empty next time.
  }
}

// The worker's own number, kept on their phone so next week's form opens with it filled in.
const PHONE_KEY = 'shiftsmart.myPhone'
export function savedPhone() {
  try {
    return localStorage.getItem(PHONE_KEY) ?? ''
  } catch {
    return ''
  }
}
export function savePhone(phone: string) {
  try {
    localStorage.setItem(PHONE_KEY, phone)
  } catch {
    // Storage blocked: the worker types it again next week.
  }
}

// A random id this phone keeps: an answer for a worker from another phone than the week's first one
// waits for the manager (someone may have typed a colleague's number).
const DEVICE_KEY = 'shiftsmart.device'
let memoryDevice = ''
export function deviceId() {
  try {
    const kept = localStorage.getItem(DEVICE_KEY)
    if (kept) return kept
    const made = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, made)
    return made
  } catch {
    memoryDevice ||= crypto.randomUUID()
    return memoryDevice
  }
}
