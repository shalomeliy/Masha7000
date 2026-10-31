import { fullName, workerHasRole } from './catalog'
import { blockingConstraint, constraintText } from './constraints'
import { addDays, dayName, isNightShift, showDate, weekOf, weekShiftCount } from './shifts'
import type { Constraint, CrewMember, ShiftDefinition, ShiftRecord, StaffSlot, Worker } from '../types/models'

// Automatic crew for one shift ("שבץ"). Pure and deterministic: the same data always gives the
// same crew. Hard rules: one worker per place, a worker fills a place only with its role and
// certification, a worker a constraint blocks or who is already in another shift at the same time is never picked. Soft rules, in
// this order: under the weekly night limit, fewest shifts this week, fewest nights this week, fewest shifts lately, name.

/** Night jobs per worker per week (Sunday to Saturday). Beyond it the worker may still be placed, with a warning. */
export const NIGHT_LIMIT = 2

export interface PlanContext {
  workers: Worker[]
  records: ShiftRecord[] // every saved shift; the planned shift itself is skipped by id
  defs: ShiftDefinition[]
  generalId: string
}

export interface Plan {
  crew: CrewMember[]
  unfilled: StaffSlot[] // places no fitting worker was found for
  why: string[] // for each unfilled place, in the same order: why nobody was found
}

export interface WorkerLoad {
  week: number // shifts this week, urgent included
  nights: number // night jobs this week
  recent: number // shifts in the four weeks before this week and in it
  overNightLimit: boolean // this shift is a night job and the worker already has NIGHT_LIMIT of them
  busy: boolean // already in another shift that runs on one of this shift's days
  blocked: Constraint | null // a constraint keeps the worker out of this shift
}

export const fitsSlot = (w: Worker, slot: StaffSlot, generalId: string) =>
  workerHasRole(w, slot.roleId, generalId) && (!slot.certificationId || w.certificationIds.includes(slot.certificationId))

/** The days a shift runs on: a night job runs into the next afternoon, an urgent one until its end date. */
function span(r: ShiftRecord, defs: ShiftDefinition[]): [string, string] {
  return [r.date, r.endDate ?? (isNightShift(r, defs) ? addDays(r.date, 1) : r.date)]
}

/** Another saved shift the worker is in that runs on one of this shift's days, if any. */
export function busyWith(workerId: string, shift: ShiftRecord, records: ShiftRecord[], defs: ShiftDefinition[]): ShiftRecord | undefined {
  const [from, to] = span(shift, defs)
  return records.find((r) => {
    if (r.id === shift.id || !r.crew.some((c) => c.workerId === workerId)) return false
    const [a, b] = span(r, defs)
    return a <= to && b >= from
  })
}

/** Crew members already in another shift at the same time, each with that shift. Saving or moving is refused then. */
export function busyCrew(shift: ShiftRecord, workers: Worker[], records: ShiftRecord[], defs: ShiftDefinition[]): { worker: Worker; other: ShiftRecord }[] {
  return shift.crew.flatMap((c) => {
    const worker = workers.find((w) => w.id === c.workerId)
    const other = worker && busyWith(worker.id, shift, records, defs)
    return worker && other ? [{ worker, other }] : []
  })
}

/** "דני כהן כבר במשמרת ביום שני 26.10 (חיפה)" for each busy crew member, or null when none is. */
export function busyText(busy: { worker: Worker; other: ShiftRecord }[]): string | null {
  if (!busy.length) return null
  return busy
    .map(({ worker, other }) => `${fullName(worker)} כבר במשמרת ביום ${dayName(other.date)} ${showDate(other.date)}${other.location ? ` (${other.location})` : ''}`)
    .join(', ')
}

export function workerLoad(worker: Worker, shift: ShiftRecord, ctx: Pick<PlanContext, 'records' | 'defs'>): WorkerLoad {
  const workerId = worker.id
  const { start, end } = weekOf(shift.date)
  const recentFrom = addDays(start, -28)
  const mine = ctx.records.filter((r) => r.id !== shift.id && r.crew.some((c) => c.workerId === workerId))
  const nights = mine.filter((r) => r.date >= start && r.date <= end && isNightShift(r, ctx.defs)).length
  return {
    week: weekShiftCount(workerId, shift.date, ctx.records, shift.id),
    nights,
    recent: mine.filter((r) => r.date >= recentFrom && r.date <= end).length,
    overNightLimit: isNightShift(shift, ctx.defs) && nights >= NIGHT_LIMIT,
    busy: !!busyWith(workerId, shift, ctx.records, ctx.defs),
    blocked: blockingConstraint(worker, shift, ctx.defs),
  }
}

/** Warning to show next to a worker in this shift, or null. */
export function loadWarning(load: WorkerLoad): string | null {
  if (load.blocked) return `${constraintText(load.blocked)}${load.blocked.note ? ` (${load.blocked.note})` : ''}`
  if (load.busy) return 'כבר במשמרת אחרת באותו זמן'
  if (load.overNightLimit) return `כבר שובץ ל-${load.nights} לילות השבוע`
  return null
}

/** Every worker, fairest pick first. Also the order of the screen's worker lists. */
export function candidateOrder(shift: ShiftRecord, ctx: PlanContext): { worker: Worker; load: WorkerLoad }[] {
  return ctx.workers
    .map((worker) => ({ worker, load: workerLoad(worker, shift, ctx) }))
    .sort(
      (a, b) =>
        Number(!!a.load.blocked) - Number(!!b.load.blocked) ||
        Number(a.load.busy) - Number(b.load.busy) ||
        Number(a.load.overNightLimit) - Number(b.load.overNightLimit) ||
        a.load.week - b.load.week ||
        a.load.nights - b.load.nights ||
        a.load.recent - b.load.recent ||
        fullName(a.worker).localeCompare(fullName(b.worker), 'he') ||
        a.worker.id.localeCompare(b.worker.id),
    )
}

/**
 * Fills the shift's places. Workers already in the crew stay (in a place of their role when they
 * fit one); the empty places get the fairest fitting workers. Uses augmenting paths, so a place
 * only one worker can fill is never left empty because that worker was used elsewhere.
 * `staffing` is the shift's staffing read through `staffingFor`.
 */
export function autoAssign(shift: ShiftRecord, staffing: StaffSlot[], ctx: PlanContext): Plan {
  const candidates = candidateOrder(shift, ctx)
  const ordered = candidates.filter((c) => !c.load.blocked && !c.load.busy).map((c) => c.worker)
  const byId = new Map(ctx.workers.map((w) => [w.id, w]))
  const locked = shift.crew.filter((c) => byId.has(c.workerId))
  const workerAt: (string | undefined)[] = staffing.map(() => undefined)
  const slotOf = new Map<string, number>()

  const put = (s: number, w: Worker) => {
    workerAt[s] = w.id
    slotOf.set(w.id, s)
  }
  // A free worker first; only when none fits, move a placed one to another place to make room.
  const place = (s: number, pool: (s: number) => Worker[], seen: Set<string>): boolean => {
    const options = pool(s).filter((w) => !seen.has(w.id))
    const free = options.find((w) => !slotOf.has(w.id))
    if (free) return (put(s, free), true)
    for (const w of options) {
      if (seen.has(w.id)) continue
      seen.add(w.id)
      if (place(slotOf.get(w.id)!, pool, seen)) return (put(s, w), true)
    }
    return false
  }
  const fill = (order: number[], pool: (s: number) => Worker[]) => {
    for (const s of order) if (workerAt[s] === undefined) place(s, pool, new Set())
  }

  const slots = staffing.map((_, i) => i)
  // The manager's own picks first: in a place of the role they were given, then in any place they fit.
  const lockedFor = (sameRole: boolean) => (s: number) =>
    locked
      .filter((c) => (!sameRole || c.roleId === staffing[s].roleId) && fitsSlot(byId.get(c.workerId)!, staffing[s], ctx.generalId))
      .map((c) => byId.get(c.workerId)!)
  fill(slots, lockedFor(true))
  fill(slots, lockedFor(false))
  // Then the rest, hardest places first (fewest fitting workers), so the fairest picks go where they matter least.
  const fitting = staffing.map((slot) => ordered.filter((w) => fitsSlot(w, slot, ctx.generalId)))
  const lockedIds = new Set(locked.map((c) => c.workerId))
  fill(
    [...slots].sort((a, b) => fitting[a].length - fitting[b].length || a - b),
    (s) => fitting[s].filter((w) => !lockedIds.has(w.id) || slotOf.has(w.id)),
  )

  const crew: CrewMember[] = []
  staffing.forEach((slot, s) => {
    const id = workerAt[s]
    if (id) crew.push({ workerId: id, roleId: slot.roleId })
  })
  // A pick of the manager's that fits no place stays as it was.
  for (const c of locked) if (!slotOf.has(c.workerId)) crew.push(c)
  const placed = new Set(crew.map((c) => c.workerId))
  const empty = staffing.filter((_, s) => workerAt[s] === undefined)
  return {
    crew,
    unfilled: empty,
    why: empty.map((slot) => {
      const fit = candidates.filter((c) => fitsSlot(c.worker, slot, ctx.generalId) && !placed.has(c.worker.id))
      const blocked = fit.filter((c) => c.load.blocked)
      const busy = fit.filter((c) => !c.load.blocked && c.load.busy)
      if (blocked.length || busy.length)
        return [
          blocked.length && `לא זמינים: ${blocked.map((c) => `${fullName(c.worker)} (${constraintText(c.load.blocked!)})`).join(', ')}`,
          busy.length && `במשמרת אחרת באותו זמן: ${busy.map((c) => fullName(c.worker)).join(', ')}`,
        ]
          .filter(Boolean)
          .join(' · ')
      return fit.length || candidates.some((c) => fitsSlot(c.worker, slot, ctx.generalId))
        ? 'כל המתאימים כבר במשמרת הזו'
        : 'אין עובד עם התפקיד וההסמכה האלה'
    }),
  }
}

export interface WeekPlanItem {
  shift: ShiftRecord // with its new crew
  added: CrewMember[] // workers "שבץ את השבוע" put in
  unfilled: StaffSlot[]
  why: string[]
}

/** The order "שבץ את השבוע" staffs shifts in: by date, night jobs first, more places first. */
export function weekPlanOrder(shifts: ShiftRecord[], staffingOf: (r: ShiftRecord) => StaffSlot[], defs: ShiftDefinition[]): ShiftRecord[] {
  return [...shifts].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      Number(isNightShift(b, defs)) - Number(isNightShift(a, defs)) ||
      staffingOf(b).length - staffingOf(a).length ||
      a.id.localeCompare(b.id),
  )
}

/**
 * "שבץ" on several shifts at once (docs/specs/week-planner.md), in `weekPlanOrder`. Each shift's
 * new crew is added to the records the next one is planned with, so fairness and "already working
 * at the same time" see it. Workers already in a shift stay in it.
 */
export function planShifts(shifts: ShiftRecord[], staffingOf: (r: ShiftRecord) => StaffSlot[], ctx: PlanContext): WeekPlanItem[] {
  let records = ctx.records
  return weekPlanOrder(shifts, staffingOf, ctx.defs).map((shift) => {
    const plan = autoAssign(shift, staffingOf(shift), { ...ctx, records })
    const before = new Set(shift.crew.map((c) => c.workerId))
    const next = { ...shift, crew: plan.crew }
    records = records.some((r) => r.id === shift.id) ? records.map((r) => (r.id === shift.id ? next : r)) : [...records, next]
    return { shift: next, added: plan.crew.filter((c) => !before.has(c.workerId)), unfilled: plan.unfilled, why: plan.why }
  })
}
