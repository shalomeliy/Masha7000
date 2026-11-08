import { isActive, staffingFor } from './catalog'
import { blockingConstraint } from './constraints'
import { crewPlaces, emptyPlaces, type GapContext } from './gaps'
import { autoAssign, busyWith, candidateOrder, fitsSlot, workerLoad } from './planner'
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

const staffingOf = (shift: ShiftRecord, ctx: GapContext) => staffingFor(shift.staffing, ctx.certifications.map((c) => c.id))

/** The shift on `date` keeps its crew and has every place filled. */
export function fitsAsIs(shift: ShiftRecord, date: string, ctx: GapContext): boolean {
  const moved = moveShift(shift, date)
  return !troubledCrew(moved, ctx).length && !emptyPlaces(moved, staffingOf(shift, ctx), ctx.workers).length
}

export interface Swap {
  out?: Worker // absent: an empty place gets a worker
  in: Worker
  from?: ShiftRecord // the other job `in` is taken out of, when they were busy there
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
 * than MAX_SWAPS workers. With `pull`, a worker in another job at the same time may be taken out
 * of it (`Swap.from`); a constraint still keeps a worker out.
 */
export function swapOn(shift: ShiftRecord, date: string, ctx: GapContext, pull = false): SwapAdvice | null {
  const moved = moveShift(shift, date)
  const staffing = staffingOf(shift, ctx)
  const troubled = troubledCrew(moved, ctx)
  // A worker who must be in the job is never swapped out: no advice then.
  if (troubled.some((id) => shift.pinnedIds?.includes(id))) return null
  if (!troubled.length && !emptyPlaces(moved, staffing, ctx.workers).length) return null
  const kept = moved.crew.filter((c) => !troubled.includes(c.workerId))
  // Pulling: the other open jobs at the same time are planned around as if empty.
  const records = pull
    ? ctx.records.map((r) => (r.id !== shift.id && !r.closure && r.crew.some((c) => busyWith(c.workerId, moved, [r], ctx.defs)) ? { ...r, crew: [] } : r))
    : ctx.records
  const plan = autoAssign({ ...moved, crew: kept }, staffing, { ...ctx, records })
  const keptIds = new Set(kept.map((c) => c.workerId))
  const added = plan.crew.filter((c) => !keptIds.has(c.workerId))
  if (plan.unfilled.length || !added.length || added.length > MAX_SWAPS) return null
  const byId = (id: string) => ctx.workers.find((w) => w.id === id)
  // Each new worker takes the place of a troubled one whose place they fit when there is one.
  const out = moved.crew.filter((c) => troubled.includes(c.workerId))
  const placeOf = crewPlaces(moved, staffing, ctx.workers)
  const take = (w: Worker | undefined) => {
    const i = out.findIndex((c) => {
      const at = placeOf.get(c.workerId)
      return !!w && at !== undefined && fitsSlot(w, staffing[at])
    })
    return i >= 0 ? out.splice(i, 1)[0] : undefined
  }
  const sameRole = added.map((c) => take(byId(c.workerId)))
  // Then any troubled one left; a new worker with none fills an empty place.
  const swaps: Swap[] = added.map((c, i) => {
    const o = sameRole[i] ?? out.shift()
    const from = pull ? busyWith(c.workerId, moved, ctx.records, ctx.defs) : undefined
    return { in: byId(c.workerId)!, out: o && byId(o.workerId), ...(from ? { from } : {}) }
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
  pull?: SwapAdvice // an earlier day still, when one of the new workers is taken out of another job
}

/**
 * The earliest day from `from` on, within ADVICE_DAYS, the job fits as is, an earlier one with a
 * swap of free workers, and an earlier one still when a worker is taken out of another job. Its own
 * day is skipped.
 */
export function moveAdvice(shift: ShiftRecord, from: string, ctx: GapContext): MoveAdvice {
  const advice: MoveAdvice = {}
  for (let i = 0; i < ADVICE_DAYS; i++) {
    const date = addDays(from, i)
    if (date === shift.date) continue
    if (fitsAsIs(shift, date, ctx)) return { ...advice, fitDate: date }
    advice.swap ??= swapOn(shift, date, ctx) ?? undefined
    if (!advice.swap) advice.pull ??= pulling(swapOn(shift, date, ctx, true))
  }
  return advice
}

// A pull that takes no one out of another job is a plain swap, already looked for.
const pulling = (a: SwapAdvice | null) => (a?.swaps.some((s) => s.from) ? a : undefined)

/**
 * Who can take `workerId`'s place in `other` once they are pulled out of it, fairest first: active,
 * free at that time, not blocked, with the place's certifications. `exclude` are workers
 * already spoken for (the crew of the job they move into).
 */
export function fillInsFor(other: ShiftRecord, workerId: string, ctx: GapContext, exclude: string[]): Worker[] {
  const staffing = staffingOf(other, ctx)
  const at = crewPlaces(other, staffing, ctx.workers).get(workerId)
  const place = at !== undefined ? staffing[at] : {}
  const taken = new Set([...exclude, ...other.crew.map((c) => c.workerId)])
  return candidateOrder(other, ctx)
    .filter((c) => !taken.has(c.worker.id) && !c.load.blocked && !c.load.busy && fitsSlot(c.worker, place))
    .map((c) => c.worker)
}

/** The swaps as saved in the shift's history, for the archive. Filling an empty place is not a swap. */
export const swapRecords = (swaps: Swap[], at: string): CrewSwap[] =>
  swaps.flatMap((s) => (s.out ? [{ at, outId: s.out.id, inId: s.in.id }] : []))
