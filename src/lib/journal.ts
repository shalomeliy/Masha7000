import { tx } from '../i18n'
import { isRealDate } from './dates'
import type { JournalEntry } from '../types/models'

// The manager's personal log ("יומן אישי", the user's request, 2026-11-20): what he did, from when to when.
// Every entry must have a date, a start time and an end time; the text is free. An end earlier than the
// start is a night: it ended the next day.

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** What is missing or wrong, in words that name the field (a tap on the note goes to it), or null. */
export function journalError(e: JournalEntry): string | null {
  if (!e.date || !isRealDate(e.date)) return tx('צריך לבחור תאריך')
  if (!TIME.test(e.start)) return tx('צריך למלא שעת התחלה')
  if (!TIME.test(e.end)) return tx('צריך למלא שעת סיום')
  if (e.start === e.end) return tx('שעת סיום לא יכולה להיות כמו שעת התחלה')
  return null
}

/** Ended after midnight, the next day. */
export const endsNextDay = (e: Pick<JournalEntry, 'start' | 'end'>) => TIME.test(e.start) && TIME.test(e.end) && minutes(e.end) < minutes(e.start)

/** How long it took, in minutes. */
export function durationOf(e: Pick<JournalEntry, 'start' | 'end'>): number {
  if (!TIME.test(e.start) || !TIME.test(e.end)) return 0
  const d = minutes(e.end) - minutes(e.start)
  return d < 0 ? d + 24 * 60 : d
}

/** "4:30" */
export const hoursText = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`

export const cleanEntry = (e: JournalEntry): JournalEntry => ({ ...e, text: e.text.trim() })

/** Newest first: by day, then by start time. */
export const newestFirst = (list: JournalEntry[]) => [...list].sort((a, b) => b.date.localeCompare(a.date) || b.start.localeCompare(a.start))

/** The entries by day, newest day first, each with its total time. */
export function byDay(list: JournalEntry[]): { date: string; total: number; entries: JournalEntry[] }[] {
  const days: { date: string; total: number; entries: JournalEntry[] }[] = []
  for (const e of newestFirst(list)) {
    const last = days[days.length - 1]
    if (last?.date === e.date) {
      last.entries.push(e)
      last.total += durationOf(e)
    } else days.push({ date: e.date, total: durationOf(e), entries: [e] })
  }
  return days
}


// ---- Times said while dictating (the user's request, 2026-11-20) ----
// "שעת התחלה 8:30 וגם שעת סיום 12:00 בדקתי את הגנרטור": the times go into their fields and leave the text,
// read here in the app, free. The entry is not saved: the manager checks it and presses Save.

const HOUR_WORDS: [string, number][] = [
  ['אחת עשרה', 11], ['אחת-עשרה', 11], ['שתים עשרה', 12], ['שתיים עשרה', 12], ['שתים-עשרה', 12], ['שתיים-עשרה', 12],
  ['אחת', 1], ['שתיים', 2], ['שתים', 2], ['שלוש', 3], ['ארבע', 4], ['חמש', 5], ['שש', 6], ['שבע', 7], ['שמונה', 8], ['תשע', 9], ['עשר', 10],
]
const PARTS: Record<string, number> = { 'וחצי': 30, 'ורבע': 15, 'ועשרה': 10, 'ועשרים': 20 }
const WORD = HOUR_WORDS.map(([w]) => w).join('|')
const LATE = 'בבוקר|בצהריים|בצהרים|אחר הצהריים|אחרי הצהריים|אחה"צ|בערב|בלילה'
const SPOKEN = new RegExp(
  `(?:ו?גם\\s+|ו)?(?:שעת\\s+|ב?שעת\\s+)?(התחלה|סיום)\\s*(?:היא\\s+|זה\\s+|-|:)?\\s*(?:ב-?\\s*|בשעה\\s+)?` +
    `(?:(\\d{1,2})(?:\\s*[:.]\\s*(\\d{2})|\\s+(\\d{2})(?!\\d))?|(\\d{3,4})|(${WORD})(?:\\s+(${Object.keys(PARTS).join('|')}))?)` +
    `(?!\\d)(?:\\s+(${LATE}))?`,
  'g',
)

const two = (n: number) => String(n).padStart(2, '0')

function toTime(hour: number, minute: number, part?: string): string | null {
  let h = hour
  if (part && /צהר|אחה|ערב/.test(part) && h < 12) h += 12
  if (part === 'בלילה') h = h === 12 ? 0 : h >= 6 && h < 12 ? h + 12 : h
  if (part === 'בבוקר' && h === 12) h = 0
  return h <= 23 && minute <= 59 ? `${two(h)}:${two(minute)}` : null
}

/** The start and end said in the text (when said), and the text without them. */
export function spokenTimes(said: string): { start?: string; end?: string; text: string } {
  const out: { start?: string; end?: string; text: string } = { text: said }
  out.text = said.replace(SPOKEN, (whole, kind: string, h?: string, m1?: string, m2?: string, packed?: string, word?: string, part?: string, late?: string) => {
    let time: string | null = null
    if (h) time = toTime(Number(h), Number(m1 ?? m2 ?? 0), late)
    else if (packed) time = toTime(Number(packed.slice(0, -2)), Number(packed.slice(-2)), late)
    else if (word) time = toTime(HOUR_WORDS.find(([w]) => w === word)![1], part ? PARTS[part] : 0, late)
    if (!time) return whole
    if (kind === 'התחלה') out.start = time
    else out.end = time
    return ' '
  })
  out.text = out.text.replace(/\s+([,.])/g, '$1').replace(/^[\s,.]+/, '').replace(/\s{2,}/g, ' ').trim()
  return out
}
