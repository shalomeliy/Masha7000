import { tx } from '../i18n'
import { fullName, isActive, isGeneralRole, staffingFor } from './catalog'
import { blockingConstraint, constraintText } from './constraints'
import type { GapContext } from './gaps'
import { ADVICE_DAYS } from './moveAdvice'
import { autoAssign, busyWith, workerLoad } from './planner'
import { addDays, moveShift } from './shifts'
import type { CrewMember, Role, ShiftRecord, Worker } from '../types/models'

// Workers who must be in a job (the user's request, 2026-11-08): "יוסי וניר חייבים להיות בעבודה הזו".
// The app finds the nearest days all of them are free, with enough other workers for the rest of
// the places. Same hard rules as "שבץ" and "הזזת עבודה": a constraint, sickness, inactivity or another job at
// the same time keeps a worker out; the weekly night limit is only a warning. Pure rules, no I/O.

/** How many days are offered at most. */
export const MAX_DATE_OPTIONS = 3

export interface DateOption {
  date: string
  shift: ShiftRecord // on that date, with the pinned workers and the rest of the crew "שבץ" found
  addedIds: string[] // the other workers "שבץ" put in
  nightIds: string[] // crew over the weekly night limit there: a warning, not a block
}

/** The pinned workers still in the crew. */
export const pinnedOf = (shift: Pick<ShiftRecord, 'crew' | 'pinnedIds'>): string[] =>
  (shift.pinnedIds ?? []).filter((id) => shift.crew.some((c) => c.workerId === id))

/** The role a worker joins a job in when no place says otherwise: their own, "כללי" only when they have no other. */
export function ownRole(w: Worker, roles: Role[], generalId: string): string {
  return w.roleIds.find((id) => roles.some((r) => r.id === id && !isGeneralRole(r))) ?? generalId
}

/** Why `w` cannot be in `shift` as it is, or null when they are free. */
export function pinnedBlock(w: Worker | undefined, shift: ShiftRecord, ctx: GapContext): string | null {
  if (!w || !isActive(w)) return tx('לא פעיל')
  const c = blockingConstraint(w, shift, ctx.defs)
  if (c) return constraintText(c)
  if (busyWith(w.id, shift, ctx.records, ctx.defs)) return tx('כבר בעבודה אחרת באותו זמן')
  return null
}

/**
 * The nearest days from `from` on, within ADVICE_DAYS, where every pinned worker is free and the
 * rest of the places can be filled. At most `max`. The pinned workers keep the role they have in
 * the job's crew (their own role when they are not in it yet).
 */
export function datesForPinned(shift: ShiftRecord, pinnedIds: string[], from: string, ctx: GapContext, max = MAX_DATE_OPTIONS): DateOption[] {
  const byId = (id: string) => ctx.workers.find((w) => w.id === id)
  const pinned: CrewMember[] = pinnedIds.flatMap((id) => {
    const w = byId(id)
    if (!w) return []
    return [shift.crew.find((c) => c.workerId === id) ?? { workerId: id, roleId: ownRole(w, ctx.roles, ctx.generalId) }]
  })
  if (!pinned.length || pinned.length < pinnedIds.length) return []
  const staffing = staffingFor(shift.staffing, ctx.roles, ctx.certifications.map((c) => c.id))
  const out: DateOption[] = []
  for (let i = 0; i < ADVICE_DAYS && out.length < max; i++) {
    const moved = moveShift({ ...shift, crew: pinned }, addDays(from, i))
    if (pinned.some((c) => pinnedBlock(byId(c.workerId), moved, ctx))) continue
    const plan = autoAssign(moved, staffing, ctx)
    if (plan.unfilled.length) continue
    const next: ShiftRecord = { ...moved, crew: plan.crew, pinnedIds }
    out.push({
      date: moved.date,
      shift: next,
      addedIds: plan.crew.filter((c) => !pinnedIds.includes(c.workerId)).map((c) => c.workerId),
      nightIds: plan.crew.flatMap((c) => {
        const w = byId(c.workerId)
        return w && workerLoad(w, next, ctx).overNightLimit ? [w.id] : []
      }),
    })
  }
  return out
}

/** "דני, משה" for workers, by id. */
export const firstNames = (ids: string[], workers: Worker[]) =>
  ids.map((id) => workers.find((w) => w.id === id)).filter((w): w is Worker => Boolean(w)).map((w) => w.firstName || fullName(w))
