import { monthNames, tx } from '../i18n'
import { fullName } from './catalog'
import { isNightShift, weekday } from './shifts'
import type { ShiftDefinition, ShiftRecord, Worker } from '../types/models'

// The monthly report: every worker's shifts in one month, by kind, for payroll and the night allowance.
// Pure rules, no I/O. A shift counts in the month of its start date, for the workers in its final crew.

export const HEBREW_MONTHS = monthNames()

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

/** Counts for any run of days; the monthly and weekly reports are both made of this. */
export interface PeriodReport {
  shifts: number
  rows: MonthRow[] // highest total first; workers with nothing at the bottom
  totals: Omit<MonthRow, 'workerId' | 'name'>
}

export interface MonthReport extends PeriodReport {
  month: string
}

export const DELETED_WORKER = tx('עובד שנמחק')

/**
 * Counts the month. `upTo` (today) leaves out shifts that have not started yet, so the current
 * month shows what was really worked.
 */
export function monthReport(month: string, records: ShiftRecord[], workers: Worker[], defs: ShiftDefinition[], upTo?: string): MonthReport {
  const { from, to } = monthDates(month)
  return { month, ...periodReport(from, to, records, workers, defs, upTo) }
}

/** Counts the shifts whose start date is in from..to (inclusive), and not after `upTo`. */
export function periodReport(from: string, to: string, records: ShiftRecord[], workers: Worker[], defs: ShiftDefinition[], upTo?: string): PeriodReport {
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

  const inPeriod = records.filter((s) => s.date >= from && s.date <= to && (!upTo || s.date <= upTo))
  for (const s of inPeriod) {
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
  const sum = (k: keyof PeriodReport['totals']) => list.reduce((n, r) => n + r[k], 0)
  return {
    shifts: inPeriod.length,
    rows: list,
    totals: { day: sum('day'), night: sum('night'), urgent: sum('urgent'), weekend: sum('weekend'), total: sum('total'), swappedOut: sum('swappedOut') },
  }
}

export const COLUMNS = [
  { key: 'day', label: tx('יום') },
  { key: 'night', label: tx('לילה') },
  { key: 'urgent', label: tx('דחופות') },
  { key: 'weekend', label: tx('סופ"ש') },
  { key: 'total', label: tx('סה"כ') },
  { key: 'swappedOut', label: tx('הוחלף') },
] as const

/** WhatsApp text: one line per worker who worked or was swapped, then the totals. */
export const monthText = (rep: MonthReport) => periodText(tx('דוח עבודות {v}', { v: monthLabel(rep.month) }), tx('בחודש'), rep)

/** WhatsApp text for any period; `inPeriod` is "בחודש" or "בשבוע". */
export function periodText(title: string, inPeriod: string, rep: PeriodReport): string {
  const line = (r: Omit<MonthRow, 'workerId' | 'name'>) =>
    [tx('{total} עבודות', { total: r.total }), tx('יום {day}', { day: r.day }), tx('לילה {night}', { night: r.night }), r.urgent && tx('דחופות {urgent}', { urgent: r.urgent }), r.weekend && tx('סופ"ש {weekend}', { weekend: r.weekend }), r.swappedOut && tx('הוחלף {swappedOut}', { swappedOut: r.swappedOut })]
      .filter(Boolean)
      .join(' · ')
  const active = rep.rows.filter((r) => r.total || r.swappedOut)
  return [
    `*${title}*`,
    '',
    ...(active.length ? active.map((r) => `*${r.name}*: ${line(r)}`) : [tx('אין עבודות {inPeriod} הזה', { inPeriod })]),
    '',
    tx('*סה"כ*: {shifts} עבודות {inPeriod} · {v}', { shifts: rep.shifts, inPeriod, v: line(rep.totals) }),
  ].join('\n')
}

/** A quoted CSV cell; text starting with = + - @ gets a ' so Excel never runs it as a formula. */
function cell(v: string | number): string {
  const s = typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV for Excel: a BOM so Hebrew shows, every worker, and a totals row. */
export function monthCsv(rep: PeriodReport): string {
  const lines = [
    [tx('עובד'), ...COLUMNS.map((c) => c.label)],
    ...rep.rows.map((r) => [r.name, ...COLUMNS.map((c) => r[c.key])]),
    [tx('סה"כ'), ...COLUMNS.map((c) => rep.totals[c.key])],
  ]
  return '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n'
}

/** `masha7000-2026-10.csv` for a month, `masha7000-week-2026-11-01.csv` for a week (its Sunday). */
export const csvFileName = (period: string) => `masha7000-${period.length > 7 ? 'week-' : ''}${period}.csv`
