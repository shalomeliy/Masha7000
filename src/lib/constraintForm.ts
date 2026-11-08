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
  return words.length ? [...words, ...(d.weekly ? ['כל שבוע'] : [])].join(', ') : ''
}

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

export const readConstraintForm = (code: string) => call<{ weekStart: string }>({ method: 'GET' }, `?c=${encodeURIComponent(code)}`)
export const submitConstraints = (code: string, phone: string, days: string[], notes: string) =>
  post<{ ok: true; firstName: string }>({ action: 'submit', code, phone, days, notes })
export const openConstraintForm = (weekStart: string, roster: RosterEntry[], renew = false) => post<{ code: string }>({ action: 'open', weekStart, roster, renew })
export const closeConstraintForm = () => post<{ code: null }>({ action: 'close' })
export const listConstraintAnswers = () => post<FormState>({ action: 'list' })
export const removeConstraintAnswers = (ids: string[]) => post<{ ok: true }>({ action: 'remove', ids })

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
