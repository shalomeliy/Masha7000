// A worker's own calendar, for the worker's card: the jobs they are in over the next few days, and
// the days they are away (sickness, vacation and the other absences, and ordinary dated constraints),
// in date order. Weekly constraints are not in it: `fixedConstraints` lists them under the days.

import { constraintText, isOver, onDay, shiftDays, sickConstraint } from './constraints'
import { addDays } from './shifts'
import type { Constraint, ShiftDefinition, ShiftRecord, Worker } from '../types/models'
import { oneLine } from './taskList'

export type AgendaItem =
  | { type: 'job'; key: string; date: string; endDate: string; shift: ShiftRecord }
  | { type: 'away'; key: string; date: string; endDate: string; constraint: Constraint; sick?: true }

/** The constraints that repeat (every week, or always) and have not ended: listed under the days. */
export const fixedConstraints = (constraints: Constraint[], today: string) => constraints.filter((c) => c.when !== 'dates' && !isOver(c, today))

/** The user's rule: the card shows only the next 3 days, today included. */
export const AGENDA_DAYS = 3

export function workerAgenda(
  w: Pick<Worker, 'id' | 'constraints' | 'status' | 'sickUntil'>,
  shifts: ShiftRecord[],
  defs: ShiftDefinition[],
  today: string,
  days = AGENDA_DAYS,
): AgendaItem[] {
  const last = addDays(today, days - 1)
  const dated: AgendaItem[] = []
  for (const s of shifts) {
    const member = s.crew.find((c) => c.workerId === w.id)
    if (!member) continue
    const endDate = shiftDays(s, defs).at(-1)!
    if (endDate < today) continue
    dated.push({ type: 'job', key: `job-${s.id}`, date: s.date, endDate, shift: s })
  }
  const sick = sickConstraint(w)
  if (sick && sick.to! >= today) dated.push({ type: 'away', key: 'sick', date: today, endDate: sick.to!, constraint: sick, sick: true })
  for (const c of w.constraints) {
    if (isOver(c, today) || c.when !== 'dates' || !c.from) continue
    const to = c.to ?? c.from
    dated.push({ type: 'away', key: `c-${c.id}`, date: c.from < today ? today : c.from, endDate: to, constraint: c, ...(c.kind === 'sick' ? { sick: true as const } : {}) })
  }
  const soon = dated.filter((i) => i.date <= last)
  // Same day: an absence first, so the manager sees it before a job that clashes with it.
  soon.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? a.endDate.localeCompare(b.endDate) : a.type === 'away' ? -1 : 1))
  return soon
}

/** The card's rows: each of the next days, today first, even an empty one (the user's rule: always 3).
 * `items` start on that day (one that began before today starts today); `going` began earlier and
 * still runs that day, so an empty-looking day says what it is part of instead of "free". */
export type AgendaDay = { date: string; items: AgendaItem[]; going: AgendaItem[] }

export function agendaDays(items: AgendaItem[], today: string, days = AGENDA_DAYS): AgendaDay[] {
  const start = (i: AgendaItem) => (i.date < today ? today : i.date)
  return Array.from({ length: days }, (_, n) => {
    const date = addDays(today, n)
    return { date, items: items.filter((i) => start(i) === date), going: items.filter((i) => start(i) < date && date <= i.endDate) }
  })
}

/** What the item says: an absence in words, or the job's place and work. */
export function agendaText(item: AgendaItem): { title: string; detail: string } {
  if (item.type === 'away') return { title: constraintText(item.constraint), detail: '' }
  const s = item.shift
  return { title: [s.location, oneLine(s.jobDescription)].filter(Boolean).join(' · '), detail: '' }
}

// ---- The worker's month: everything on each day, past days too ----

export type DayEntry =
  | { type: 'job'; key: string; shift: ShiftRecord; endDate: string }
  | { type: 'away'; key: string; constraint: Constraint; sick: boolean }

/** Every day of `month` (YYYY-MM) with what the worker has on it: jobs (a night job on both its
 * days), sickness, absences and constraints, weekly ones included. Sickness from the status has no
 * start date, so it is shown from today to its last day. Days with nothing are left out. */
export function workerMonth(
  w: Pick<Worker, 'id' | 'constraints' | 'status' | 'sickUntil'>,
  shifts: ShiftRecord[],
  defs: ShiftDefinition[],
  month: string,
  today: string,
): Map<string, DayEntry[]> {
  const first = `${month}-01`
  const days: string[] = []
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) days.push(d)
  const out = new Map<string, DayEntry[]>()
  const put = (day: string, e: DayEntry) => out.set(day, [...(out.get(day) ?? []), e])
  const sick = sickConstraint(w)
  for (const day of days) {
    if (sick && day >= today && day <= sick.to!) put(day, { type: 'away', key: 'sick', constraint: sick, sick: true })
    for (const c of w.constraints) if (onDay(c, day)) put(day, { type: 'away', key: `c-${c.id}`, constraint: c, sick: c.kind === 'sick' })
  }
  for (const s of shifts) {
    const member = s.crew.find((c) => c.workerId === w.id)
    if (!member) continue
    const run = shiftDays(s, defs)
    for (const day of run) if (day.startsWith(month)) put(day, { type: 'job', key: `job-${s.id}`, shift: s, endDate: run.at(-1)! })
  }
  // On each day: sickness and absences first, then jobs.
  for (const list of out.values()) list.sort((a, b) => (a.type === b.type ? 0 : a.type === 'away' ? -1 : 1))
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)))
}
