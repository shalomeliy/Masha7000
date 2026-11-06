// A worker's state right now, for the badge on the card and the team's state at the top of the
// list: fit to work, sick, on vacation, studying, reserve duty, a course, or inactive. It is worked
// out from what is already saved (the status and the dated absences), so it changes by itself
// when a sickness or a vacation ends.

import { ABSENCE_NAMES, onDay } from './constraints'
import { addDays, showDate } from './shifts'
import type { AbsenceKind, Constraint, Worker } from '../types/models'

export type StateId = 'fit' | 'sick' | AbsenceKind | 'inactive'

export interface WorkerState {
  id: StateId
  label: string // "כשיר", "במחלה עד 9.11", "בחופש עד 12.11"
}

// In the order the team's state is listed.
export const STATE_ORDER: StateId[] = ['fit', 'sick', 'vacation', 'study', 'reserve', 'course', 'inactive']

export const STATE_NAMES: Record<StateId, string> = {
  fit: 'כשירים',
  sick: 'במחלה',
  vacation: 'בחופש',
  study: 'בלימודים',
  reserve: 'במילואים',
  course: 'בהשתלמות',
  inactive: 'לא פעילים',
}

// Colors as Tailwind classes: a dot and a soft badge per state.
export const STATE_TONE: Record<StateId, { dot: string; badge: string }> = {
  fit: { dot: 'bg-emerald-400', badge: 'bg-emerald-500/15 text-emerald-200' },
  sick: { dot: 'bg-rose-400', badge: 'bg-rose-500/15 text-rose-200' },
  vacation: { dot: 'bg-sky-400', badge: 'bg-sky-500/15 text-sky-200' },
  study: { dot: 'bg-violet-400', badge: 'bg-violet-500/15 text-violet-200' },
  reserve: { dot: 'bg-lime-400', badge: 'bg-lime-500/15 text-lime-200' },
  course: { dot: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-200' },
  inactive: { dot: 'bg-slate-400', badge: 'bg-slate-700 text-slate-200' },
}

/** The absence covering `today`, if any (the one ending last, when two overlap). */
export function absenceToday(w: Pick<Worker, 'constraints'>, today: string): Constraint | null {
  const now = w.constraints.filter((c) => c.kind && onDay(c, today))
  return now.sort((a, b) => (b.to ?? '9999').localeCompare(a.to ?? '9999'))[0] ?? null
}

export function workerState(w: Pick<Worker, 'status' | 'sickUntil' | 'constraints'>, today: string): WorkerState {
  if (w.status === 'inactive') return { id: 'inactive', label: 'לא פעיל' }
  if (w.status === 'sick' && w.sickUntil && w.sickUntil >= today) return { id: 'sick', label: `במחלה עד ${showDate(w.sickUntil)}` }
  const away = absenceToday(w, today)
  if (away?.kind) {
    const until = away.when === 'dates' && away.to && away.to !== today ? ` עד ${showDate(away.to)}` : away.when === 'weekdays' ? ' היום' : ''
    return { id: away.kind, label: `${ABSENCE_NAMES[away.kind]}${until}` }
  }
  return { id: 'fit', label: 'כשיר לעבודה' }
}

/** How many workers are in each state today, in STATE_ORDER, leaving out states nobody is in. */
export function teamStates(workers: Worker[], today: string): { id: StateId; count: number }[] {
  const counts = new Map<StateId, number>()
  for (const w of workers) {
    const id = workerState(w, today).id
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return STATE_ORDER.filter((id) => counts.has(id)).map((id) => ({ id, count: counts.get(id)! }))
}

/** Back to work today: an absence going on today ends yesterday, or is removed if it starts today. */
export function endAbsence(list: Constraint[], today: string): Constraint[] {
  return list.flatMap((c) => {
    if (!c.kind || c.when !== 'dates' || !c.from || !c.to || c.from > today || c.to < today) return [c]
    return c.from === today ? [] : [{ ...c, to: addDays(today, -1) }]
  })
}
