import { newId, slotCerts } from './catalog'
import type { Certification, StaffSlot, WorkKind } from '../types/models'

// Work kinds ("סוג עבודה"): picking kinds in a job fills its staffing with their places.
// Pure rules, no I/O.

const same = (a: string, b: string) => a.trim().replace(/\s+/g, ' ') === b.trim().replace(/\s+/g, ' ')

/** Two places may be filled by one worker only when they came from two different kinds. */
export const canShare = (a: StaffSlot, b: StaffSlot) => !!a.kindId && !!b.kindId && a.kindId !== b.kindId

/**
 * Places with a need of their own are kept; only the kind's own places come and go. Places that ask
 * for nothing (a job from "לשיבוץ" often comes with a few) are only a head count, so a kind replaces them.
 */
const isPlain = (staffing: StaffSlot[]) => staffing.every((s) => !s.kindId && !slotCerts(s).length)

/** A kind's place as a job holds it: its certifications and the kind it came from. */
const kindPlace = (s: StaffSlot, kindId: string): StaffSlot => {
  const certs = slotCerts(s)
  return { ...(certs.length ? { certificationIds: certs } : {}), kindId }
}

/**
 * Turns one kind on or off in a job. On: its places are added after the others (a job with only bare
 * places that ask for nothing gets just the kind's places). Off: its places are removed.
 */
export function toggleKind(
  job: { staffing: StaffSlot[]; workKindIds?: string[] },
  kind: WorkKind,
): { staffing: StaffSlot[]; workKindIds: string[] } {
  const ids = job.workKindIds ?? []
  if (ids.includes(kind.id)) {
    const staffing = job.staffing.filter((s) => s.kindId !== kind.id)
    return { staffing: staffing.length ? staffing : [{}], workKindIds: ids.filter((id) => id !== kind.id) }
  }
  const base = !ids.length && isPlain(job.staffing) ? [] : job.staffing
  const added = kind.staffing.map((s) => kindPlace(s, kind.id))
  const staffing = [...base, ...added]
  return { staffing: staffing.length ? staffing : [{}], workKindIds: [...ids, kind.id] }
}

/** The kind ids a job holds that still exist, so a deleted kind is not shown as picked. */
export const pickedKinds = (ids: string[] | undefined, kinds: WorkKind[]) => (ids ?? []).filter((id) => kinds.some((k) => k.id === id))

export const WELDER_CERT = 'רתך'
export const CLIMB_CERT = 'טיפוס'

/** The level a kind made today has. Kinds of earlier versions were repaired up to it; kept so a saved kind reads the same. */
export const KIND_FIXED = 3

/**
 * The first kinds, "טיפוס" (3 people, 2 of them with the certification "טיפוס") and "ריתוך" (one
 * person with "רתך"), with the certifications they need that are missing.
 */
export function starterKinds(certs: Certification[]): { certs: Certification[]; kinds: WorkKind[] } {
  const newCerts: Certification[] = []
  const cert = (name: string) => {
    const found = certs.find((c) => same(c.name, name))
    if (found) return found.id
    const c = { id: newId(), name }
    newCerts.push(c)
    return c.id
  }
  const climb = cert(CLIMB_CERT)
  const welder = cert(WELDER_CERT)
  return {
    certs: newCerts,
    kinds: [
      { id: newId(), name: 'טיפוס', staffing: [{}, { certificationIds: [climb] }, { certificationIds: [climb] }], fixed: KIND_FIXED },
      { id: newId(), name: 'ריתוך', staffing: [{ certificationIds: [welder] }], fixed: KIND_FIXED },
    ],
  }
}
