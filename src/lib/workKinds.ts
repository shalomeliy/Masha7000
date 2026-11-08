import { generalRoleId, newId, slotCerts } from './catalog'
import type { Certification, Role, StaffSlot, WorkKind } from '../types/models'

// Work kinds ("סוג עבודה"): picking kinds in a job fills its staffing with their places.
// Pure rules, no I/O.

const same = (a: string, b: string) => a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ')

/** Two places may be filled by one worker only when they came from two different kinds. */
export const canShare = (a: StaffSlot, b: StaffSlot) => !!a.kindId && !!b.kindId && a.kindId !== b.kindId

/**
 * Places with a need of their own are kept; only the kind's own places come and go. Bare "כללי"
 * places (a job from "לשיבוץ" often comes with a few) are only a head count, so a kind replaces them.
 */
const isPlain = (staffing: StaffSlot[], generalId: string) =>
  staffing.every((s) => !s.kindId && s.roleId === generalId && !slotCerts(s).length && !s.alsoRoleIds?.length)

/**
 * Turns one kind on or off in a job. On: its places are added after the others (a job with only bare
 * "כללי" places gets just the kind's places). Off: its places are removed.
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

export const CLIMB_CERT = 'טיפוס'

/** The repair level a kind made or fixed today has; see `repairKinds`. */
export const KIND_FIXED = 3

/** The "טיפוס" certification, or a new one to add when there is none. */
function climbCert(certs: Certification[]): { id: string; added?: Certification } {
  const found = certs.find((c) => same(c.name, CLIMB_CERT))
  if (found) return { id: found.id }
  const added = { id: newId(), name: CLIMB_CERT }
  return { id: added.id, added }
}

/**
 * Fixes saved kinds so every place shows the role it really needs:
 * - a place whose role no longer exists needs "כללי" (before, the screen showed the first role in the list);
 * - once: "טיפוס" from an earlier version becomes מנהל טיפוס + 2 "כללי" with the certification "טיפוס",
 *   as the manager asked. The first version's climber role may have any name (renamed, or an older
 *   role): such a place is known by also taking the first place's role. A kind changed by hand after
 *   that is kept.
 * Returns null when nothing changed; `certs` holds a certification to add first, if one is needed.
 */
export function repairKinds(kinds: WorkKind[], roles: Role[], certs: Certification[]): { kinds: WorkKind[]; certs: Certification[] } | null {
  const general = generalRoleId(roles)
  const exists = (id: string) => roles.some((r) => r.id === id)
  const nameOf = (id: string) => roles.find((r) => r.id === id)?.name ?? ''
  const isClimber = (id: string) => same(nameOf(id), CLIMBER) || same(nameOf(id), CLIMBER_OLD)
  const cert = climbCert(certs)
  let changed = false
  let certUsed = false
  const next = kinds.map((k) => {
    const oldStarter = (k.fixed ?? 0) < KIND_FIXED && same(k.name, 'טיפוס')
    const staffing = k.staffing.map((s, i) => {
      const lost = !exists(s.roleId)
      const plain = !slotCerts(s).length && !s.alsoRoleIds?.length
      const likeStarter = isClimber(s.roleId) || !!s.altRoleIds?.includes(k.staffing[0].roleId)
      const climber = oldStarter && i > 0 && s.roleId !== general && likeStarter && plain
      const withCert = oldStarter && i > 0 && plain && (climber || lost || s.roleId === general)
      if (!lost && !climber && !withCert) return s
      const fixed: StaffSlot = { ...s, roleId: lost || climber || withCert ? general : s.roleId, altRoleIds: climber || withCert ? undefined : s.altRoleIds?.filter(exists) }
      if (withCert) {
        certUsed = true
        return { ...fixed, certificationId: undefined, certificationIds: [cert.id] }
      }
      return fixed
    })
    const touched = staffing.some((s, i) => s !== k.staffing[i])
    if (!touched && !oldStarter) return k
    changed = true
    return { ...k, staffing: staffing.map(dropEmpty), fixed: KIND_FIXED }
  })
  if (!changed) return null
  return { kinds: next, certs: certUsed && cert.added ? [cert.added] : [] }
}

/** Leaves out empty fields, so a repaired place looks like one made by hand. */
const dropEmpty = (s: StaffSlot): StaffSlot =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) as StaffSlot

/**
 * The first kinds, "טיפוס" (מנהל טיפוס + 2 "כללי" with the certification "טיפוס") and "ריתוך" (one
 * person with "רתך"), with the roles and certifications they need that are missing.
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
  const general = generalRoleId(roles)
  const climb = climbCert(certs)
  if (climb.added) newCerts.push(climb.added)
  let welder = certs.find((c) => same(c.name, WELDER_CERT))?.id
  if (!welder) {
    welder = newId()
    newCerts.push({ id: welder, name: WELDER_CERT })
  }
  return {
    roles: newRoles,
    certs: newCerts,
    kinds: [
      { id: newId(), name: 'טיפוס', staffing: [{ roleId: manager }, { roleId: general, certificationIds: [climb.id] }, { roleId: general, certificationIds: [climb.id] }], fixed: KIND_FIXED },
      { id: newId(), name: 'ריתוך', staffing: [{ roleId: general, certificationIds: [welder] }], fixed: KIND_FIXED },
    ],
  }
}
