import { fullName, isActive, slotCerts, workerHasRole } from './catalog'
import { blockingConstraint, constraintText } from './constraints'
import { addDays, dayName, isNightShift, showDate, weekOf, weekShiftCount } from './shifts'
import { canShare } from './workKinds'
import type { Constraint, CrewMember, ShiftDefinition, ShiftRecord, StaffSlot, Worker } from '../types/models'

// Automatic crew for one shift ("שבץ"). Pure and deterministic: the same data always gives the
// same crew. Hard rules: one worker per place, a worker fills a place only with its role and
// certification (places of two different work kinds may share one worker), a worker a constraint blocks or who is already in another shift at the same time is never picked. Soft rules, in
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
  (workerHasRole(w, slot.roleId, generalId) || !!slot.altRoleIds?.some((id) => w.roleIds.includes(id))) &&
  (slot.alsoRoleIds ?? []).every((id) => workerHasRole(w, id, generalId)) &&
  slotCerts(slot).every((id) => w.certificationIds.includes(id))

/** Why a place stays empty when no worker at all holds everything it needs, with what to do about it. */
export const NO_WORKER = 'אין עובד שמחזיק את כל הדרישות של המקום הזה. כדאי להוסיף עובד כזה, או לסמן לעובד קיים את מה שחסר לו בלשונית "עובדים".'

/** The role a worker fills a place in: the place's own role when they hold it, else the other role they hold. */
export const roleInSlot = (w: Worker, slot: StaffSlot, generalId: string) =>
  workerHasRole(w, slot.roleId, generalId) ? slot.roleId : (slot.altRoleIds?.find((id) => w.roleIds.includes(id)) ?? slot.roleId)

const slotRoles = (slot: StaffSlot) => [slot.roleId, ...(slot.altRoleIds ?? [])]

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

/**
 * The records with these workers taken out of every other open shift that runs at the same time as
 * `shift`: the manager chose to move them into it. `fillIns` maps a pulled worker to the one who
 * takes their place there (kept in that shift's swap history); without one the place is left empty.
 * Records that do not change are the same objects.
 */
export function pullFrom(
  shift: ShiftRecord,
  workerIds: string[],
  records: ShiftRecord[],
  defs: ShiftDefinition[],
  fillIns: Record<string, string> = {},
  at = new Date().toISOString(),
): ShiftRecord[] {
  return records.map((r) => {
    if (r.id === shift.id || r.closure) return r
    const pulled = r.crew.filter((c) => workerIds.includes(c.workerId) && busyWith(c.workerId, shift, [r], defs))
    if (!pulled.length) return r
    const crew = r.crew.flatMap((c) => (!pulled.includes(c) ? [c] : fillIns[c.workerId] ? [{ ...c, workerId: fillIns[c.workerId] }] : []))
    const swaps = pulled.flatMap((c) => (fillIns[c.workerId] ? [{ at, outId: c.workerId, inId: fillIns[c.workerId], roleId: c.roleId }] : []))
    return { ...r, crew, ...(swaps.length ? { swaps: [...(r.swaps ?? []), ...swaps] } : {}) }
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

/** "דני כהן כבר בעבודה ביום שני 26.10 (חיפה)" for each busy crew member, or null when none is. */
export function busyText(busy: { worker: Worker; other: ShiftRecord }[]): string | null {
  if (!busy.length) return null
  return busy
    .map(({ worker, other }) => `${fullName(worker)} כבר בעבודה ביום ${dayName(other.date)} ${showDate(other.date)}${other.location ? ` (${other.location})` : ''}`)
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
  if (load.busy) return 'כבר בעבודה אחרת באותו זמן'
  if (load.overNightLimit) return `כבר שובץ ל-${load.nights} לילות השבוע`
  return null
}

/** Every active worker, fairest pick first. Also the order of the screen's worker lists. */
export function candidateOrder(shift: ShiftRecord, ctx: PlanContext): { worker: Worker; load: WorkerLoad }[] {
  return ctx.workers
    .filter(isActive)
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
 * A place of one work kind is filled by a worker already in a place of another kind when one fits
 * (a climber who welds takes the "ריתוך" place too), and among new workers the one who can also
 * fill places of other kinds comes first, so the job needs as few people as it can.
 * `staffing` is the shift's staffing read through `staffingFor`.
 */
export function autoAssign(shift: ShiftRecord, staffing: StaffSlot[], ctx: PlanContext): Plan {
  const candidates = candidateOrder(shift, ctx)
  const ordered = candidates.filter((c) => !c.load.blocked && !c.load.busy).map((c) => c.worker)
  const byId = new Map(ctx.workers.map((w) => [w.id, w]))
  const locked = shift.crew.filter((c) => byId.has(c.workerId))
  const workerAt: (string | undefined)[] = staffing.map(() => undefined)
  const sharedAt: (string | undefined)[] = staffing.map(() => undefined)
  const slotOf = new Map<string, number>()
  const filled = (s: number) => workerAt[s] !== undefined || sharedAt[s] !== undefined
  // Every place a worker fills: their own and the ones of other kinds they also cover.
  const coversOf = (id: string) => [...(slotOf.has(id) ? [slotOf.get(id)!] : []), ...sharedAt.flatMap((x, t) => (x === id ? [t] : []))]
  const canTake = (s: number, id: string, skip = -1) =>
    fitsSlot(byId.get(id)!, staffing[s], ctx.generalId) && coversOf(id).every((t) => t === skip || canShare(staffing[t], staffing[s]))

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
  // A worker already in the job who may also take this place, in the order they came in.
  const share = (s: number) => {
    if (!staffing[s].kindId) return false
    const id = [...slotOf.keys()].find((x) => canTake(s, x))
    if (id) sharedAt[s] = id
    return !!id
  }
  const fill = (order: number[], pool: (s: number) => Worker[]) => {
    for (const s of order) if (!filled(s) && !share(s)) place(s, pool, new Set())
  }

  const slots = staffing.map((_, i) => i)
  // The manager's own picks first: in a place of the role they were given, then in any place they fit.
  const lockedFor = (sameRole: boolean) => (s: number) =>
    locked
      .filter((c) => (!sameRole || slotRoles(staffing[s]).includes(c.roleId)) && fitsSlot(byId.get(c.workerId)!, staffing[s], ctx.generalId))
      .map((c) => byId.get(c.workerId)!)
  const lockedPass = (sameRole: boolean) => {
    for (const s of slots) if (!filled(s)) place(s, lockedFor(sameRole), new Set())
  }
  lockedPass(true)
  lockedPass(false)
  // Then the rest, hardest places first (fewest fitting workers), so the fairest picks go where they matter least.
  const fitting = staffing.map((slot) => ordered.filter((w) => fitsSlot(w, slot, ctx.generalId)))
  const lockedIds = new Set(locked.map((c) => c.workerId))
  // How many other kinds, still unfilled, this worker could also cover from place `s`.
  const extraKinds = (w: Worker, s: number) =>
    new Set(slots.filter((t) => t !== s && !filled(t) && canShare(staffing[s], staffing[t]) && fitsSlot(w, staffing[t], ctx.generalId)).map((t) => staffing[t].kindId)).size
  const pool = (s: number) => {
    const fit = fitting[s].filter((w) => !lockedIds.has(w.id) || slotOf.has(w.id))
    const extra = new Map(fit.map((w) => [w.id, extraKinds(w, s)]))
    return [...fit].sort((a, b) => extra.get(b.id)! - extra.get(a.id)!)
  }
  const order = [...slots].sort((a, b) => fitting[a].length - fitting[b].length || a - b)
  fill(order, pool)
  // Moving a worker to make room may leave them in two places of the same kind: drop those and try again.
  slots.forEach((s) => {
    const id = sharedAt[s]
    if (id && !canTake(s, id, s)) sharedAt[s] = undefined
  })
  fill(order, pool)

  const crew: CrewMember[] = []
  staffing.forEach((slot, s) => {
    const id = workerAt[s]
    if (id) crew.push({ workerId: id, roleId: roleInSlot(byId.get(id)!, slot, ctx.generalId) })
  })
  // A pick of the manager's that fits no place stays as it was.
  for (const c of locked) if (!slotOf.has(c.workerId)) crew.push(c)
  const placed = new Set(crew.map((c) => c.workerId))
  const empty = staffing.filter((_, s) => !filled(s))
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
          busy.length && `בעבודה אחרת באותו זמן: ${busy.map((c) => fullName(c.worker)).join(', ')}`,
        ]
          .filter(Boolean)
          .join(' · ')
      return fit.length || candidates.some((c) => fitsSlot(c.worker, slot, ctx.generalId))
        ? 'כל המתאימים כבר בעבודה הזו'
        : NO_WORKER
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
