import { newId } from './catalog'
import { dateError } from './dates'
import { addDays, HEBREW_DAYS, isNightShift, showDate, weekday } from './shifts'
import type { Constraint, DayPart, ShiftDefinition, ShiftRecord, Worker } from '../types/models'

// Worker constraints: when a worker cannot work. Pure rules, no I/O. The planner never places a
// worker a constraint blocks; the screens show why.

export const blankConstraint = (from = ''): Constraint => ({ id: newId(), when: 'dates', from, to: from })

/** Upgrades the spec's `{ id, date, reason }` and fills missing fields. */
export function normalizeConstraint(raw: Partial<Constraint> & { date?: string; reason?: string }): Constraint {
  const { date, reason, ...c } = raw
  const when = c.when ?? 'dates'
  const from = c.from ?? date
  return {
    ...c,
    id: c.id ?? newId(),
    when,
    from: when === 'dates' ? from : undefined,
    to: when === 'dates' ? (c.to ?? from) : undefined,
    weekdays: when === 'weekdays' ? (c.weekdays ?? []) : undefined,
    nightsOnly: when === 'always' ? true : c.nightsOnly || undefined,
    note: c.note ?? (reason?.trim() || undefined),
  }
}

export function constraintError(c: Constraint): string | null {
  if (c.when === 'dates') {
    const from = dateError(c.from ?? '', { required: true })
    if (from) return `תאריך ההתחלה: ${from}`
    const to = dateError(c.to ?? '', { required: true, min: c.from })
    if (to) return `תאריך הסיום: ${to}`
  }
  if (c.when === 'weekdays' && !c.weekdays?.length) return 'צריך לסמן לפחות יום אחד בשבוע'
  return null
}

const dayList = (days: number[]) => {
  const names = [...days].sort().map((d) => HEBREW_DAYS[d])
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ו${names.at(-1)}` : names[0]
}

export const PART_NAMES: Record<DayPart, string> = { morning: 'בבוקר', noon: 'בצהריים', evening: 'בערב' }

/** "לא זמין 1.11 עד 5.11", "לא זמין בערב ב-2.11", "בלי לילות בימי שלישי", "בלי לילות בכלל". The note is not included. */
export function constraintText(c: Constraint): string {
  const what = c.nightsOnly ? 'בלי לילות' : c.part ? `לא זמין ${PART_NAMES[c.part]}` : 'לא זמין'
  if (c.when === 'always') return 'בלי לילות בכלל'
  if (c.when === 'weekdays') return `${what} ${c.weekdays?.length === 1 ? 'ביום' : 'בימי'} ${dayList(c.weekdays ?? [])}`
  if (!c.from) return what
  // A Hebrew word between the dates: "1.11 - 5.11" shows reversed in a right-to-left line.
  return c.to && c.to !== c.from ? `${what} ${showDate(c.from)} עד ${showDate(c.to)}` : `${what} ב-${showDate(c.from)}`
}

/** A date range that ended before today no longer matters; weekly and permanent ones always do. */
export const isOver = (c: Constraint, today: string) => c.when === 'dates' && !!c.to && c.to < today

const onDay = (c: Constraint, date: string) =>
  c.when === 'always' || (c.when === 'weekdays' ? !!c.weekdays?.includes(weekday(date)) : !!c.from && c.from <= date && date <= (c.to ?? c.from))

/** The days a shift runs on: a night job runs into the next afternoon, an urgent one until its end date. */
export function shiftDays(r: ShiftRecord, defs: ShiftDefinition[]): string[] {
  const last = r.endDate ?? (isNightShift(r, defs) ? addDays(r.date, 1) : r.date)
  const days = [r.date]
  while (days.length < 31 && days.at(-1)! < last) days.push(addDays(days.at(-1)!, 1))
  return days
}

/**
 * The first constraint that keeps this worker out of this shift, or null. A whole-day, morning or
 * noon constraint blocks a shift on any of its days (a night job ends the next afternoon). An evening
 * one blocks only a day the shift runs past: not the last day, which ends at 16:00, unless an urgent
 * shift ends later. A nights-only one blocks a night job that starts on one of its days.
 */
export function blockingConstraint(w: Pick<Worker, 'constraints'>, shift: ShiftRecord, defs: ShiftDefinition[]): Constraint | null {
  const night = isNightShift(shift, defs)
  const days = shiftDays(shift, defs)
  const endTime = shift.urgent ? shift.endTime : defs.find((d) => d.id === shift.shiftDefinitionId)?.endTime
  const endsInEvening = (endTime ?? '16:00') >= EVENING_FROM
  const blocks = (c: Constraint, d: string, last: boolean) => onDay(c, d) && (c.part !== 'evening' || !last || endsInEvening)
  return (
    w.constraints.find((c) => (c.nightsOnly ? night && onDay(c, shift.date) : days.some((d, i) => blocks(c, d, i === days.length - 1)))) ?? null
  )
}

const EVENING_FROM = '17:00'

// Reading a worker's words: which part of the day they mean. No server, so a word table, not a
// language model. Words match inside longer words, so Hebrew prefixes (ב, ל, ה, ו) need no care.
// Order (user rules): a time of day the worker wrote wins; then words that always mean the whole
// day (לימודים, חופש); then events, which are in the evening; then plain "can't", the whole day.

const MORNING = ['בוקר']
const NOON = ['צהריים', 'צהרים', 'אחה"צ', 'אחה״צ', 'אחהצ']
const EVENING = ['ערב', 'לילה', 'לילות']
const WHOLE_DAY_WORDS = ['לימוד', 'חופש', 'מילואים', 'מחלה', 'חולה', 'לוויה', 'הלוויה', 'שבעה', 'טיסה', 'טס ', 'טסה', 'חו"ל', 'חו״ל', 'בחו ל', 'נופש', 'בחינה', 'מבחן', 'קורס', 'אבל ']
const EVENT_WORDS = ['אירוע', 'ארוע', 'חתונ', 'בר מצו', 'בת מצו', 'בר-מצו', 'בת-מצו', 'ברית', 'חינה', 'אירוסין', 'מסיבה', 'יום הולדת', 'יומולדת', 'הופעה', 'הצגה', 'ארוחת ערב']
const CANT_WORDS = ['לא יכול', 'לא זמין', 'לא עובד', 'לא אוכל', 'לא מגיע', 'רופא', 'טיפול', 'בדיק', 'תור ', 'סידורים', 'משפחתי', 'אישי']

export interface Reading {
  part?: DayPart // absent = whole day
  nightsOnly?: true
  guess?: true // no known word: whole day, to be safe
  cause?: string // the word that decided, for the preview: "אירוע"
}

const has = (text: string, words: string[]) => words.find((w) => text.includes(w))

/** "ב-10", "עד 12", "מ-18:00", "בשעה 8": the part of the day of an hour the worker wrote. A date has a dot, so it is not an hour. */
function hourPart(t: string): DayPart | undefined {
  const m = t.match(/(?:^|\s)(?:ב|עד|מ|משעה|בשעה|אחרי|לפני|החל מ)\s*-?\s*(\d{1,2})(?::\d\d)?(?![\d.])/)
  if (!m) return undefined
  const h = Number(m[1])
  return h > 23 ? undefined : h < 12 ? 'morning' : h < 17 ? 'noon' : 'evening'
}

/** What a worker's answer for one day means. */
export function readAnswer(answer: string): Reading {
  const t = ` ${answer.trim()} `
  const asked = [has(t, MORNING) && 'morning', has(t, NOON) && 'noon', has(t, EVENING) && 'evening'].filter(Boolean) as DayPart[]
  const stem = (has(t, WHOLE_DAY_WORDS) ?? has(t, EVENT_WORDS) ?? has(t, CANT_WORDS))?.trim()
  // The worker's whole word, not the table's stem: "חתונה", not "חתונ".
  const cause = stem && t.match(new RegExp(`[^\\s,.]*${stem}[^\\s,.]*`))?.[0]
  const why = cause ? { cause } : {}
  if (/כל היום|יום שלם/.test(t) || asked.length > 1) return why
  // "בלי לילה", "לא לילות": no night jobs; the day itself is free.
  if (asked[0] === 'evening' && !/ערב/.test(t) && !has(t, EVENT_WORDS)) return { nightsOnly: true, ...why }
  if (asked.length === 1) return { part: asked[0], ...why }
  if (has(t, WHOLE_DAY_WORDS)) return why
  const hour = hourPart(t)
  if (hour) return { part: hour, ...why }
  if (has(t, EVENT_WORDS)) return { part: 'evening', ...why }
  if (cause) return why
  return { guess: true }
}

/** "ערב · אירוע", "כל היום · לימוד", "כל היום (ניחוש)": what was understood, for the paste preview. */
export function readingText(r: { part?: DayPart; nightsOnly?: boolean; guess?: boolean; cause?: string }): string {
  const what = r.nightsOnly ? 'בלי לילה' : r.part ? PART_NAMES[r.part].slice(1) : 'כל היום'
  return `${what}${r.cause ? ` · ${r.cause}` : ''}${r.guess ? ' (ניחוש, לא הבנתי את המילים)' : ''}`
}

// The WhatsApp request the manager sends and the worker fills in: one line per day of the week.
// A pasted reply is read back by day name, so it survives the worker deleting the dates or the colon.

const NO_CONSTRAINT = /^(אין|אין אילוץ|אין אילוצים|-|—|\.|✓|✔️?|👍)?$/
const NOTES_LABEL = 'הערות:'

export function requestText(weekStart: string): string {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const year = days[6].slice(0, 4)
  return [
    `*בקשת אילוצים לשבוע ${showDate(days[0])} עד ${showDate(days[6])}.${year}*`,
    'באם יש לך אילוץ נא הזן אותו, לדוגמה (חופש, ארוע בערב, לימודים).',
    'באם אין אילוץ השאר ריק.',
    'בסיום שלח את ההודעה בחזרה.',
    '',
    ...days.map((d) => `${HEBREW_DAYS[weekday(d)]} ${showDate(d)}: `),
    '',
    `${NOTES_LABEL} `,
  ].join('\n')
}

export interface ParsedReply {
  weekStart: string | null // from the header, when the worker kept it
  constraints: Constraint[]
  notes: string
}

const strip = (s: string) => s.replace(/[*_~]/g, '').trim()

/**
 * Reads a filled request back. A day with anything but "אין אילוץ" becomes a one-day constraint,
 * for the part of the day its words mean (`readAnswer`). The worker's words are kept as the note.
 * `weekStart` is used when the header with the dates was cut off.
 */
export function parseReply(text: string, weekStart: string): ParsedReply {
  const lines = text.split(/\r?\n/).map(strip)
  const header = lines.find((l) => l.startsWith('בקשת אילוצים'))?.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  const fromHeader = header ? weekStartOf(`${header[3]}-${header[2].padStart(2, '0')}-${header[1].padStart(2, '0')}`) : null
  const start = fromHeader ?? weekStart
  const constraints: Constraint[] = []
  const notes: string[] = []
  let inNotes = false
  for (const line of lines) {
    if (line.startsWith(NOTES_LABEL.slice(0, -1))) {
      inNotes = true
      notes.push(line.slice(NOTES_LABEL.length - 1).replace(/^[:\s]+/, ''))
      continue
    }
    if (inNotes) {
      notes.push(line)
      continue
    }
    // "ראשון 1.11: לא יכול", "יום ראשון - בלי לילה", "ראשון לא יכול". A lookahead, not a word
    // boundary: JS does not count Hebrew letters as word letters.
    const m = line.match(/^(?:יום\s+)?(ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת)(?=[\s:\-–]|$)\s*(?:\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)?\s*[:\-–]?\s*(.*)$/)
    if (!m) continue
    const answer = m[2].trim()
    if (NO_CONSTRAINT.test(answer)) continue
    const date = addDays(start, HEBREW_DAYS.indexOf(m[1]))
    const { cause: _, ...reading } = readAnswer(answer)
    constraints.push({ id: newId(), when: 'dates', from: date, to: date, ...reading, note: answer })
  }
  return { weekStart: fromHeader, constraints, notes: notes.filter((n) => n && !NO_CONSTRAINT.test(n)).join('\n') }
}

const weekStartOf = (date: string) => addDays(date, -weekday(date))
