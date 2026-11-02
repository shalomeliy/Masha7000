import { fullName } from './catalog'
import { isNightShift, weekday } from './shifts'
import type { ShiftDefinition, ShiftRecord, Worker } from '../types/models'

// The monthly report: every worker's shifts in one month, by kind, for payroll and the night allowance.
// Pure rules, no I/O. A shift counts in the month of its start date, for the workers in its final crew.

export const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר']

/** "2026-10" -> "אוקטובר 2026". */
export const monthLabel = (month: string) => `${HEBREW_MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`

/** Moves a YYYY-MM month by `delta` months. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

/** The month to open on: the previous one until the 5th (the report is made then), else this one. */
export const defaultMonth = (today: string) => (Number(today.slice(8, 10)) < 5 ? addMonths(today.slice(0, 7), -1) : today.slice(0, 7))

/** First and last day of a YYYY-MM month; `upTo` (today) cuts the current month short, like the report. */
export function monthDates(month: string, upTo?: string): { from: string; to: string } {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()
  const to = `${month}-${String(last).padStart(2, '0')}`
  return { from: `${month}-01`, to: upTo && upTo < to ? upTo : to }
}

export interface MonthRow {
  workerId: string
  name: string
  day: number
  night: number
  urgent: number // also counted in day or night
  weekend: number // Friday or Saturday, also counted in day or night
  total: number // day + night
  swappedOut: number // shifts the worker was in and replaced; not in the total
}

export interface MonthReport {
  month: string
  shifts: number
  rows: MonthRow[] // highest total first; workers with nothing at the bottom
  totals: Omit<MonthRow, 'workerId' | 'name'>
}

export const DELETED_WORKER = 'עובד שנמחק'

/**
 * Counts the month. `upTo` (today) leaves out shifts that have not started yet, so the current
 * month shows what was really worked.
 */
export function monthReport(month: string, records: ShiftRecord[], workers: Worker[], defs: ShiftDefinition[], upTo?: string): MonthReport {
  const rows = new Map<string, MonthRow>()
  const row = (id: string) => {
    let r = rows.get(id)
    if (!r) {
      const w = workers.find((x) => x.id === id)
      r = { workerId: id, name: w ? fullName(w) : DELETED_WORKER, day: 0, night: 0, urgent: 0, weekend: 0, total: 0, swappedOut: 0 }
      rows.set(id, r)
    }
    return r
  }
  workers.forEach((w) => row(w.id))

  const inMonth = records.filter((s) => s.date.startsWith(`${month}-`) && (!upTo || s.date <= upTo))
  for (const s of inMonth) {
    const night = isNightShift(s, defs)
    const weekend = weekday(s.date) >= 5
    const crew = new Set(s.crew.map((c) => c.workerId))
    for (const id of crew) {
      const r = row(id)
      if (night) r.night++
      else r.day++
      if (s.urgent) r.urgent++
      if (weekend) r.weekend++
      r.total++
    }
    const out = new Set((s.swaps ?? []).map((x) => x.outId).filter((id) => !crew.has(id)))
    for (const id of out) row(id).swappedOut++
  }

  const list = [...rows.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'he') || a.workerId.localeCompare(b.workerId))
  const sum = (k: keyof MonthReport['totals']) => list.reduce((n, r) => n + r[k], 0)
  return {
    month,
    shifts: inMonth.length,
    rows: list,
    totals: { day: sum('day'), night: sum('night'), urgent: sum('urgent'), weekend: sum('weekend'), total: sum('total'), swappedOut: sum('swappedOut') },
  }
}

export const COLUMNS = [
  { key: 'day', label: 'יום' },
  { key: 'night', label: 'לילה' },
  { key: 'urgent', label: 'דחופות' },
  { key: 'weekend', label: 'סופ"ש' },
  { key: 'total', label: 'סה"כ' },
  { key: 'swappedOut', label: 'הוחלף' },
] as const

/** WhatsApp text: one line per worker who worked or was swapped, then the totals. */
export function monthText(rep: MonthReport): string {
  const line = (r: Omit<MonthRow, 'workerId' | 'name'>) =>
    [`${r.total} עבודות`, `יום ${r.day}`, `לילה ${r.night}`, r.urgent && `דחופות ${r.urgent}`, r.weekend && `סופ"ש ${r.weekend}`, r.swappedOut && `הוחלף ${r.swappedOut}`]
      .filter(Boolean)
      .join(' · ')
  const active = rep.rows.filter((r) => r.total || r.swappedOut)
  return [
    `*דוח עבודות ${monthLabel(rep.month)}*`,
    '',
    ...(active.length ? active.map((r) => `*${r.name}*: ${line(r)}`) : ['אין עבודות בחודש הזה']),
    '',
    `*סה"כ*: ${rep.shifts} עבודות בחודש · ${line(rep.totals)}`,
  ].join('\n')
}

/** A quoted CSV cell; text starting with = + - @ gets a ' so Excel never runs it as a formula. */
function cell(v: string | number): string {
  const s = typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV for Excel: a BOM so Hebrew shows, every worker, and a totals row. */
export function monthCsv(rep: MonthReport): string {
  const lines = [
    ['עובד', ...COLUMNS.map((c) => c.label)],
    ...rep.rows.map((r) => [r.name, ...COLUMNS.map((c) => r[c.key])]),
    ['סה"כ', ...COLUMNS.map((c) => rep.totals[c.key])],
  ]
  return '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n'
}

export const csvFileName = (month: string) => `masha7000-${month}.csv`
