import { fullName, isActive, placeText, staffingFor } from './catalog'
import { blockedCrew, blockingConstraint, constraintText } from './constraints'
import { fitsSlot, NO_WORKER, workerLoad } from './planner'
import { canShare } from './workKinds'
import type { Certification, Role, ShiftDefinition, ShiftRecord, StaffSlot, Worker } from '../types/models'

// The week at a glance (docs/specs/week-gaps.md): what each open shift still needs. Pure rules, no I/O.
// Closed night jobs are history and are never checked.

export type GapKind = 'missing' | 'blocked' | 'double' | 'nights'

export const GAP_KINDS: GapKind[] = ['missing', 'blocked', 'double', 'nights']

export interface MissingPlace {
  slot: StaffSlot
  why?: string // only when nobody can fill it as things are; otherwise "שבץ" may still fill it
}

export interface ShiftGaps {
  missing: MissingPlace[]
  doubleIds: string[] // crew members in another shift that runs at the same time
  nightIds: string[] // crew members over the weekly night limit with this shift
  blockedIds: string[] // crew members a constraint keeps out of this shift
  kinds: GapKind[]
}

export interface GapContext {
  workers: Worker[]
  records: ShiftRecord[]
  defs: ShiftDefinition[]
  roles: Role[]
  certifications: Certification[]
  generalId: string
}

const fills = (w: Worker, roleId: string, slot: StaffSlot, generalId: string) =>
  (slot.roleId === generalId || roleId === slot.roleId || !!slot.altRoleIds?.includes(roleId)) && fitsSlot(w, slot, generalId)

/**
 * The places of `staffing` the crew leaves empty. A crew member fills a place of the role they
 * fill in this shift (any member fills a "כללי" place) when they hold its certification. Matched
 * with augmenting paths, so the order of the crew never makes a place look empty.
 */
export function emptyPlaces(shift: ShiftRecord, staffing: StaffSlot[], workers: Worker[], generalId: string): StaffSlot[] {
  const filled = new Set([...crewCover(shift, staffing, workers, generalId).values()].flat())
  return staffing.filter((_, s) => !filled.has(s))
}

/** Which place (index in `staffing`) each crew member fills, by worker id. A member who fills none is left out. */
export function crewPlaces(shift: ShiftRecord, staffing: StaffSlot[], workers: Worker[], generalId: string): Map<string, number> {
  return new Map([...crewCover(shift, staffing, workers, generalId)].map(([id, places]) => [id, places[0]]))
}

/**
 * Every place each crew member fills, their own first. A member also covers an empty place of
 * another work kind they fit with any role they hold, never two places of the same kind.
 */
export function crewCover(shift: ShiftRecord, staffing: StaffSlot[], workers: Worker[], generalId: string): Map<string, number[]> {
  const members = shift.crew.flatMap((c) => {
    const w = workers.find((x) => x.id === c.workerId)
    return w ? [{ w, roleId: c.roleId }] : []
  })
  const memberAt: (number | undefined)[] = staffing.map(() => undefined)
  const tryPlace = (m: number, seen: Set<number>): boolean => {
    for (let s = 0; s < staffing.length; s++) {
      if (seen.has(s) || !fills(members[m].w, members[m].roleId, staffing[s], generalId)) continue
      seen.add(s)
      if (memberAt[s] === undefined || tryPlace(memberAt[s]!, seen)) return ((memberAt[s] = m), true)
    }
    return false
  }
  members.forEach((_, m) => tryPlace(m, new Set()))
  const places = new Map<string, number[]>()
  memberAt.forEach((m, s) => m !== undefined && places.set(members[m].w.id, [s]))
  staffing.forEach((slot, s) => {
    if (memberAt[s] !== undefined || !slot.kindId) return
    const m = members.find(({ w }) => {
      const mine = places.get(w.id)
      return mine && fitsSlot(w, slot, generalId) && mine.every((t) => canShare(staffing[t], slot))
    })
    if (m) places.get(m.w.id)!.push(s)
  })
  return places
}

/** Why no one can fill this place, or undefined when some worker outside the crew still could. */
function whyEmpty(slot: StaffSlot, shift: ShiftRecord, ctx: GapContext): string | undefined {
  const inCrew = new Set(shift.crew.map((c) => c.workerId))
  const active = ctx.workers.filter(isActive)
  const fit = active.filter((w) => !inCrew.has(w.id) && fills(w, slot.roleId, slot, ctx.generalId))
  if (!active.some((w) => fills(w, slot.roleId, slot, ctx.generalId))) return NO_WORKER
  if (!fit.length) return 'כל המתאימים כבר בעבודה הזו'
  const blocked = fit.map((w) => ({ w, c: blockingConstraint(w, shift, ctx.defs) }))
  if (blocked.every((b) => b.c)) return `לא זמינים: ${blocked.map((b) => `${fullName(b.w)} (${constraintText(b.c!)})`).join(', ')}`
  return undefined
}

export function shiftGaps(shift: ShiftRecord, ctx: GapContext): ShiftGaps {
  const none: ShiftGaps = { missing: [], doubleIds: [], nightIds: [], blockedIds: [], kinds: [] }
  if (shift.closure) return none
  const staffing = staffingFor(shift.staffing, ctx.roles, ctx.certifications.map((c) => c.id))
  const missing = emptyPlaces(shift, staffing, ctx.workers, ctx.generalId).map((slot) => ({ slot, why: whyEmpty(slot, shift, ctx) }))
  const loads = shift.crew.flatMap((c) => {
    const w = ctx.workers.find((x) => x.id === c.workerId)
    return w ? [{ id: w.id, load: workerLoad(w, shift, ctx) }] : []
  })
  const doubleIds = loads.filter((l) => l.load.busy).map((l) => l.id)
  const nightIds = loads.filter((l) => l.load.overNightLimit).map((l) => l.id)
  const blockedIds = blockedCrew(shift, ctx.workers, ctx.defs).map((b) => b.worker.id)
  const kinds = GAP_KINDS.filter(
    (k) => ({ missing: missing.length, blocked: blockedIds.length, double: doubleIds.length, nights: nightIds.length })[k] > 0,
  )
  return { missing, doubleIds, nightIds, blockedIds, kinds }
}

/** How many shifts have each kind of gap. A shift with two kinds counts in both. */
export function gapCounts(gaps: ShiftGaps[]): Record<GapKind, number> {
  const counts: Record<GapKind, number> = { missing: 0, blocked: 0, double: 0, nights: 0 }
  for (const g of gaps) for (const k of g.kinds) counts[k]++
  return counts
}

export { placeText }
