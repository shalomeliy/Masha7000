// A worker's own calendar, for the worker's card: the jobs they are in over the next few days, and
// the days they are away (sickness, vacation and the other absences, and ordinary dated constraints),
// in date order. Weekly constraints are not in it: they stay in the card's constraints list.

import { constraintText, isOver, shiftDays, sickConstraint } from './constraints'
import { addDays } from './shifts'
import type { Constraint, Role, ShiftDefinition, ShiftRecord, Worker } from '../types/models'

export type AgendaItem =
  | { type: 'job'; key: string; date: string; endDate: string; shift: ShiftRecord; roleId: string }
  | { type: 'away'; key: string; date: string; endDate: string; constraint: Constraint; sick?: true }

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
    dated.push({ type: 'job', key: `job-${s.id}`, date: s.date, endDate, shift: s, roleId: member.roleId })
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

/** What the item says: an absence in words, or the job's place and work. */
export function agendaText(item: AgendaItem, roles: Role[]): { title: string; detail: string } {
  if (item.type === 'away') return { title: constraintText(item.constraint), detail: '' }
  const s = item.shift
  const role = roles.find((r) => r.id === item.roleId)?.name ?? ''
  return { title: [s.location, s.jobDescription].filter(Boolean).join(' · '), detail: role }
}

/** The worker's own constraints the calendar shows, so the card's constraints list leaves them out
 * (the user's rule: each shown once). A guess read from WhatsApp stays in the list, to be checked there. */
export const agendaConstraintIds = (items: AgendaItem[]): string[] =>
  items.flatMap((i) => (i.type === 'away' && i.key !== 'sick' && !i.constraint.guess ? [i.constraint.id] : []))
