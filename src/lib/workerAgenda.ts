// A worker's own calendar, for the worker's card: the jobs they are in from today on, and the days
// they are away (sickness, vacation and the other absences, and ordinary constraints), in date order.
// A weekly constraint has no single date; it is listed apart, as "every week".

import { constraintText, isOver, shiftDays, sickConstraint } from './constraints'
import type { Constraint, Role, ShiftDefinition, ShiftRecord, Worker } from '../types/models'

export type AgendaItem =
  | { type: 'job'; key: string; date: string; endDate: string; shift: ShiftRecord; roleId: string }
  | { type: 'away'; key: string; date: string; endDate: string; constraint: Constraint; sick?: true }

export interface Agenda {
  dated: AgendaItem[] // jobs and dated absences, by first day (an absence going on today sorts as today)
  weekly: Constraint[] // weekly and "always" constraints still in force
}

export function workerAgenda(
  w: Pick<Worker, 'id' | 'constraints' | 'status' | 'sickUntil'>,
  shifts: ShiftRecord[],
  defs: ShiftDefinition[],
  today: string,
): Agenda {
  const dated: AgendaItem[] = []
  for (const s of shifts) {
    const member = s.crew.find((c) => c.workerId === w.id)
    if (!member) continue
    const days = shiftDays(s, defs)
    const endDate = days.at(-1)!
    if (endDate < today) continue
    dated.push({ type: 'job', key: `job-${s.id}`, date: s.date, endDate, shift: s, roleId: member.roleId })
  }
  const sick = sickConstraint(w)
  if (sick && sick.to! >= today) dated.push({ type: 'away', key: 'sick', date: today, endDate: sick.to!, constraint: sick, sick: true })
  const weekly: Constraint[] = []
  for (const c of w.constraints) {
    if (isOver(c, today)) continue
    if (c.when !== 'dates') {
      weekly.push(c)
      continue
    }
    if (!c.from) continue
    const to = c.to ?? c.from
    dated.push({ type: 'away', key: `c-${c.id}`, date: c.from < today ? today : c.from, endDate: to, constraint: c, ...(c.kind === 'sick' ? { sick: true as const } : {}) })
  }
  // Same day: an absence first, so the manager sees it before a job that clashes with it.
  dated.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? a.endDate.localeCompare(b.endDate) : a.type === 'away' ? -1 : 1))
  return { dated, weekly }
}

/** What the item says: an absence in words, or the job's place and work. */
export function agendaText(item: AgendaItem, roles: Role[]): { title: string; detail: string } {
  if (item.type === 'away') return { title: constraintText(item.constraint), detail: '' }
  const s = item.shift
  const role = roles.find((r) => r.id === item.roleId)?.name ?? ''
  return { title: [s.location, s.jobDescription].filter(Boolean).join(' · '), detail: role }
}
