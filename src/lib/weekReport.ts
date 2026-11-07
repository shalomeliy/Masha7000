import { tx } from '../i18n'
import { periodReport, periodText } from './monthReport'
import type { PeriodReport } from './monthReport'
import { weekday } from './shifts'
import type { ShiftDefinition, ShiftRecord, Worker } from '../types/models'

// The weekly report: the monthly report's counts for one Israeli week, Sunday to Saturday.
// A week is named by its Sunday (YYYY-MM-DD).

/** Moves a YYYY-MM-DD date by `delta` days. */
export function addDays(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

/** The Sunday that starts the week of `date`. */
export const weekOf = (date: string) => addDays(date, -weekday(date))

/** The week to open on: last week on Sunday (nothing worked yet this week), else this one. */
export const defaultWeek = (today: string) => weekOf(weekday(today) === 0 ? addDays(today, -1) : today)

/** Sunday..Saturday of a week; `upTo` (today) cuts the current week short, like the report. */
export function weekDates(sunday: string, upTo?: string): { from: string; to: string } {
  const to = addDays(sunday, 6)
  return { from: sunday, to: upTo && upTo < to ? upTo : to }
}

const dm = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}`

/** "2026-11-01" -> "1.11–7.11.2026" (the year of the Saturday). */
export function weekLabel(sunday: string): string {
  const sat = addDays(sunday, 6)
  return `${dm(sunday)}–${dm(sat)}.${sat.slice(0, 4)}`
}

export interface WeekReport extends PeriodReport {
  week: string
}

export function weekReport(sunday: string, records: ShiftRecord[], workers: Worker[], defs: ShiftDefinition[], upTo?: string): WeekReport {
  const { from, to } = weekDates(sunday)
  return { week: sunday, ...periodReport(from, to, records, workers, defs, upTo) }
}

export const weekText = (rep: WeekReport) => periodText(tx('דוח עבודות שבועי {v}', { v: weekLabel(rep.week) }), tx('בשבוע'), rep)
