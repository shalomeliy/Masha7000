import { isActive, staffingFor } from './catalog'
import { blockingConstraint } from './constraints'
import { emptyPlaces, type GapContext } from './gaps'
import { autoAssign, busyWith, workerLoad } from './planner'
import { addDays, moveShift } from './shifts'
import type { CrewSwap, ShiftRecord, Worker } from '../types/models'

// Moving a job with staffing problems (docs/specs/move-advice.md): which days it fits on with the
// same crew, and the earliest day a swap of one or two workers makes it fit. Pure rules, no I/O.
// Same hard rules as "שבץ": a constraint, sickness, inactivity or another job at the same time keeps
// a worker out; the weekly night limit is only a warning.

/** Workers a swap may change at most: more than that is a new crew, not a swap. */
export const MAX_SWAPS = 2
/** How far ahead the advice looks, in days. */
export const ADVICE_DAYS = 60

/** Crew members who cannot work this shift as it is: gone, inactive, blocked or in another job at the same time. */
export function troubledCrew(shift: ShiftRecord, ctx: GapContext): string[] {
  return shift.crew
    .filter((c) => {
      const w = ctx.workers.find((x) => x.id === c.workerId)
      return !w || !isActive(w) || !!blockingConstraint(w, shift, ctx.defs) || !!busyWith(w.id, shift, ctx.records, ctx.defs)
    })
    .map((c) => c.workerId)
}

const staffingOf = (shift: ShiftRecord, ctx: GapContext) => staffingFor(shift.staffing, ctx.roles, ctx.certifications.map((c) => c.id))

/** The shift on `date` keeps its crew and has every place filled. */
export function fitsAsIs(shift: ShiftRecord, date: string, ctx: GapContext): boolean {
  const moved = moveShift(shift, date)
  return !troubledCrew(moved, ctx).length && !emptyPlaces(moved, staffingOf(shift, ctx), ctx.workers, ctx.generalId).length
}

export interface Swap {
  out?: Worker // absent: an empty place gets a worker
  in: Worker
  roleId: string
}

export interface SwapAdvice {
  date: string
  shift: ShiftRecord // moved, with the new crew
  swaps: Swap[]
  dropped: Worker[] // troubled members no one took the place of (they filled no place)
  nightIds: string[] // crew over the weekly night limit there: a warning, not a block
}

/**
 * The shift on `date` with its troubled members swapped and its empty places filled, the fairest
 * way "שבץ" knows; null when it already fits, when some place stays empty, or when it takes more
 * than MAX_SWAPS workers.
 */
export function swapOn(shift: ShiftRecord, date: string, ctx: GapContext): SwapAdvice | null {
  const moved = moveShift(shift, date)
  const staffing = staffingOf(shift, ctx)
  const troubled = troubledCrew(moved, ctx)
  if (!troubled.length && !emptyPlaces(moved, staffing, ctx.workers, ctx.generalId).length) return null
  const kept = moved.crew.filter((c) => !troubled.includes(c.workerId))
  const plan = autoAssign({ ...moved, crew: kept }, staffing, ctx)
  const keptIds = new Set(kept.map((c) => c.workerId))
  const added = plan.crew.filter((c) => !keptIds.has(c.workerId))
  if (plan.unfilled.length || !added.length || added.length > MAX_SWAPS) return null
  const byId = (id: string) => ctx.workers.find((w) => w.id === id)
  // Each new worker takes the place of a troubled one of the same role when there is one.
  const out = moved.crew.filter((c) => troubled.includes(c.workerId))
  const take = (roleId: string) => {
    const i = out.findIndex((c) => c.roleId === roleId)
    return i >= 0 ? out.splice(i, 1)[0] : undefined
  }
  const sameRole = added.map((c) => take(c.roleId))
  // Then any troubled one left; a new worker with none fills an empty place.
  const swaps: Swap[] = added.map((c, i) => {
    const o = sameRole[i] ?? out.shift()
    return { in: byId(c.workerId)!, roleId: c.roleId, out: o && byId(o.workerId) }
  })
  const next = { ...moved, crew: plan.crew }
  return {
    date,
    shift: next,
    swaps,
    dropped: out.flatMap((c) => byId(c.workerId) ?? []),
    nightIds: plan.crew.flatMap((c) => {
      const w = byId(c.workerId)
      return w && workerLoad(w, next, ctx).overNightLimit ? [w.id] : []
    }),
  }
}

export interface MoveAdvice {
  fitDate?: string // the earliest day the job fits with the same crew
  swap?: SwapAdvice // an earlier day, when swapping a worker or two makes the job fit there
}

/** The earliest day from `from` on, within ADVICE_DAYS, the job fits as is, and an earlier one with a swap. Its own day is skipped. */
export function moveAdvice(shift: ShiftRecord, from: string, ctx: GapContext): MoveAdvice {
  const advice: MoveAdvice = {}
  for (let i = 0; i < ADVICE_DAYS; i++) {
    const date = addDays(from, i)
    if (date === shift.date) continue
    if (fitsAsIs(shift, date, ctx)) return { ...advice, fitDate: date }
    advice.swap ??= swapOn(shift, date, ctx) ?? undefined
  }
  return advice
}

/** The swaps as saved in the shift's history, for the archive. Filling an empty place is not a swap. */
export const swapRecords = (swaps: Swap[], at: string): CrewSwap[] =>
  swaps.flatMap((s) => (s.out ? [{ at, outId: s.out.id, inId: s.in.id, roleId: s.roleId }] : []))
