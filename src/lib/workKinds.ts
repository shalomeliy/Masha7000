import { generalRoleId, newId } from './catalog'
import type { Certification, Role, StaffSlot, WorkKind } from '../types/models'

// Work kinds ("סוג עבודה"): picking kinds in a job fills its staffing with their places.
// Pure rules, no I/O.

const same = (a: string, b: string) => a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ')

/** Two places may be filled by one worker only when they came from two different kinds. */
export const canShare = (a: StaffSlot, b: StaffSlot) => !!a.kindId && !!b.kindId && a.kindId !== b.kindId

/** Places added by hand are kept; only the kind's own places come and go. */
const isPlain = (staffing: StaffSlot[], generalId: string) =>
  staffing.length === 1 && !staffing[0].kindId && staffing[0].roleId === generalId && !staffing[0].certificationId

/**
 * Turns one kind on or off in a job. On: its places are added after the others (a job with only the
 * default single "כללי" place gets just the kind's places). Off: its places are removed.
 */
export function toggleKind(
  job: { staffing: StaffSlot[]; workKindIds?: string[] },
  kind: WorkKind,
  generalId: string,
): { staffing: StaffSlot[]; workKindIds: string[] } {
  const ids = job.workKindIds ?? []
  if (ids.includes(kind.id)) {
    const staffing = job.staffing.filter((s) => s.kindId !== kind.id)
    return { staffing: staffing.length ? staffing : [{ roleId: generalId }], workKindIds: ids.filter((id) => id !== kind.id) }
  }
  const base = !ids.length && isPlain(job.staffing, generalId) ? [] : job.staffing
  const added = kind.staffing.map((s) => ({ ...s, kindId: kind.id }))
  const staffing = [...base, ...added]
  return { staffing: staffing.length ? staffing : [{ roleId: generalId }], workKindIds: [...ids, kind.id] }
}

/** The kind ids a job holds that still exist, so a deleted kind is not shown as picked. */
export const pickedKinds = (ids: string[] | undefined, kinds: WorkKind[]) => (ids ?? []).filter((id) => kinds.some((k) => k.id === id))

export const CLIMB_MANAGER = 'מנהל טיפוס'
export const CLIMBER = 'מטפס'
// An older name for a climber the manager may already use; taken as "מטפס" instead of adding a second role.
export const CLIMBER_OLD = 'טפסן'
export const WELDER_CERT = 'רתך'

/**
 * The first kinds, "טיפוס" (מנהל טיפוס + 2 places a "מטפס" or "מנהל טיפוס" fills) and "ריתוך"
 * (one person with "רתך"), with the roles and certification they need that are missing.
 * An existing "טפסן" is used as the climber when there is no "מטפס".
 */
export function starterKinds(roles: Role[], certs: Certification[]): { roles: Role[]; certs: Certification[]; kinds: WorkKind[] } {
  const newRoles: Role[] = []
  const newCerts: Certification[] = []
  const role = (...names: string[]) => {
    const found = roles.find((r) => names.some((n) => same(r.name, n)))
    if (found) return found.id
    const r = { id: newId(), name: names[0] }
    newRoles.push(r)
    return r.id
  }
  const manager = role(CLIMB_MANAGER)
  const climber = roles.some((r) => same(r.name, CLIMBER)) ? role(CLIMBER) : role(CLIMBER, CLIMBER_OLD)
  let welder = certs.find((c) => same(c.name, WELDER_CERT))?.id
  if (!welder) {
    welder = newId()
    newCerts.push({ id: welder, name: WELDER_CERT })
  }
  const climberPlace: StaffSlot = { roleId: climber, altRoleIds: [manager] }
  return {
    roles: newRoles,
    certs: newCerts,
    kinds: [
      { id: newId(), name: 'טיפוס', staffing: [{ roleId: manager }, climberPlace, { ...climberPlace }] },
      { id: newId(), name: 'ריתוך', staffing: [{ roleId: generalRoleId(roles), certificationId: welder }] },
    ],
  }
}
