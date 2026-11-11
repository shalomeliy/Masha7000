// A worker's state right now, for the badge on the card and the team's state at the top of the
// list: fit to work, sick, on vacation, studying, reserve duty, a course, or inactive. It is worked
// out from what is already saved (the status and the dated absences), so it changes by itself
// when a sickness or a vacation ends.

import { ABSENCE_NAMES, onDay } from './constraints'
import { addDays, showDate } from './shifts'
import type { AbsenceKind, Constraint, Worker } from '../types/models'
import { tx } from '../i18n'

// away: not available all day for a reason that is not one of the absence kinds ("לא זמין 11.11 עד 25.11").
export type StateId = 'fit' | 'sick' | AbsenceKind | 'away' | 'inactive'

export interface WorkerState {
  id: StateId
  label: string // "כשיר", "במחלה עד 9.11", "בחופש עד 12.11"
}

// In the order the team's state is listed.
export const STATE_ORDER: StateId[] = ['fit', 'sick', 'vacation', 'study', 'reserve', 'course', 'away', 'inactive']

export const STATE_NAMES: Record<StateId, string> = {
  fit: tx('כשירים'),
  sick: tx('במחלה'),
  vacation: tx('בחופש'),
  study: tx('בלימודים'),
  reserve: tx('במילואים'),
  course: tx('בהשתלמות'),
  away: tx('לא זמינים'),
  inactive: tx('לא פעילים'),
}

// Colors as Tailwind classes: a dot and a soft badge per state.
export const STATE_TONE: Record<StateId, { dot: string; badge: string }> = {
  fit: { dot: 'bg-emerald-400', badge: 'bg-emerald-500/15 text-emerald-200' },
  sick: { dot: 'bg-rose-400', badge: 'bg-rose-500/15 text-rose-200' },
  vacation: { dot: 'bg-sky-400', badge: 'bg-sky-500/15 text-sky-200' },
  study: { dot: 'bg-violet-400', badge: 'bg-violet-500/15 text-violet-200' },
  reserve: { dot: 'bg-lime-400', badge: 'bg-lime-500/15 text-lime-200' },
  course: { dot: 'bg-amber-400', badge: 'bg-amber-500/15 text-amber-200' },
  away: { dot: 'bg-fuchsia-400', badge: 'bg-fuchsia-500/15 text-fuchsia-200' },
  inactive: { dot: 'bg-slate-400', badge: 'bg-slate-700 text-slate-200' },
}

// A plain constraint whose note names an absence counts as that absence ("חופש" typed as the reason).
const NOTE_KINDS: [RegExp, AbsenceKind][] = [
  [/חופש|נופש|טיול|חו"ל|חו״ל/, 'vacation'],
  [/מילואים/, 'reserve'],
  [/השתלמות|קורס|הכשרה/, 'course'],
  [/לימוד|בחינה|מבחן/, 'study'],
  [/מחלה|חולה/, 'sick'],
]

/** What keeps a worker out the whole day: an absence, or a plain constraint for the whole day. */
const wholeDay = (c: Constraint) => !!c.kind || (c.when !== 'always' && !c.nightsOnly && !c.part)

/** The absence or whole-day constraint covering `today`, if any (the one ending last, when two overlap). */
export function absenceToday(w: Pick<Worker, 'constraints'>, today: string): Constraint | null {
  const now = w.constraints.filter((c) => wholeDay(c) && onDay(c, today))
  return now.sort((a, b) => (b.to ?? '9999').localeCompare(a.to ?? '9999'))[0] ?? null
}

const kindOf = (c: Constraint): AbsenceKind | null => c.kind ?? NOTE_KINDS.find(([re]) => re.test(c.note ?? ''))?.[1] ?? null

export function workerState(w: Pick<Worker, 'status' | 'sickUntil' | 'constraints'>, today: string): WorkerState {
  if (w.status === 'inactive') return { id: 'inactive', label: tx('לא פעיל') }
  if (w.status === 'sick' && w.sickUntil && w.sickUntil >= today) return { id: 'sick', label: tx('במחלה עד {v}', { v: showDate(w.sickUntil) }) }
  const away = absenceToday(w, today)
  if (away) {
    const until = away.when === 'dates' && away.to && away.to !== today ? tx(' עד {v}', { v: showDate(away.to) }) : away.when === 'weekdays' ? tx(' היום') : ''
    const kind = kindOf(away)
    return kind ? { id: kind, label: `${ABSENCE_NAMES[kind]}${until}` } : { id: 'away', label: `${tx('לא זמין')}${until}` }
  }
  return { id: 'fit', label: tx('כשיר לעבודה') }
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
    if (!wholeDay(c) || c.when !== 'dates' || !c.from || !c.to || c.from > today || c.to < today) return [c]
    return c.from === today ? [] : [{ ...c, to: addDays(today, -1) }]
  })
}
