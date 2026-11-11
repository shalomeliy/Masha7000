import { tx } from '../i18n'
import type { Certification, Department, ShiftDefinition, StaffSlot, Worker } from '../types/models'
import { normalizeConstraint } from './constraints'

// Pure rules for the master lists (certifications, workers, shift types). No I/O here.

export const STANDBY_HEADCOUNT = 3

export const STARTER_CERTIFICATIONS = [
  'אנטנה עד גובה 20 מטר',
  'אנטנה בגובה 40 מטר',
  'אנטנה מעל 40 מטר',
  'חשמלאי מוסמך',
  'מהנדס חשמל',
]

// The departments list before the manager changes it. Fixed ids, so a restored backup still matches its workers.
export const STARTER_DEPARTMENTS: Department[] = [
  { id: 'dept-communication', name: 'תקשורת' },
  { id: 'dept-masts', name: 'תרנים' },
  { id: 'dept-rokek', name: 'רוקק' },
  { id: 'dept-penetration', name: 'נתיבי חדירה' },
  { id: 'dept-robots', name: 'רובוטים' },
  { id: 'dept-drones', name: 'רחפנים' },
]

/** An Israeli ID number (ת.ז): exactly 9 digits. Spaces and dashes are ignored. */
export const isIsraeliId = (id: string | undefined) => /^\d{9}$/.test((id ?? '').replace(/[\s-]/g, ''))

// The user does not care about exact hours for now: a shift starts in the morning and ends at 16:00,
// either the same day or (a night job) the next day. Times are stored for the calendar later.
export const SHIFT_START = '07:00'
export const SHIFT_END = '16:00'

// The user's pattern: everyone works days; some also go out to a night job that ends the next afternoon.
export const STARTER_SHIFTS: Omit<ShiftDefinition, 'id'>[] = [
  { name: 'יום', startTime: SHIFT_START, endTime: SHIFT_END, requiredHeadcount: 1, requiredCertificationIds: [] },
  {
    name: 'לילה',
    startTime: SHIFT_START,
    endTime: SHIFT_END,
    endsNextDay: true,
    requiredHeadcount: 1,
    requiredCertificationIds: [],
  },
]

// "לינה": a night job after which the same crew goes on to another job before returning to base.
// It counts as a night everywhere. Built in: lists saved before it existed get it on read.
// It was called "לילה+" before; a type still named so is renamed on read.
export const NIGHT_PLUS_ID = 'night-plus'
export const NIGHT_PLUS_NAME = 'לינה'
const OLD_NIGHT_PLUS_NAME = 'לילה+'
export const NIGHT_PLUS: ShiftDefinition = {
  id: NIGHT_PLUS_ID,
  name: NIGHT_PLUS_NAME,
  startTime: SHIFT_START,
  endTime: SHIFT_END,
  endsNextDay: true,
  thenJob: true,
  requiredHeadcount: 1,
  requiredCertificationIds: [],
}

/** The shift types with "לינה" in them: a type already named so is marked, else it is added last. */
export function withNightPlus(saved: ShiftDefinition[]): ShiftDefinition[] {
  const old = saved.some((d) => normalize(d.name) === OLD_NIGHT_PLUS_NAME)
  const defs = old ? saved.map((d) => (normalize(d.name) === OLD_NIGHT_PLUS_NAME ? { ...d, name: NIGHT_PLUS_NAME } : d)) : saved
  if (defs.length === 0 || defs.some((d) => d.thenJob)) return defs
  const named = defs.find((d) => normalize(d.name) === normalize(NIGHT_PLUS_NAME))
  return named ? defs.map((d) => (d === named ? { ...d, endsNextDay: true, thenJob: true } : d)) : [...defs, NIGHT_PLUS]
}

/** The type a new planned shift starts with: "יום", or the first type that ends the same day. */
export const defaultShiftDef = (defs: ShiftDefinition[]) =>
  defs.find((d) => d.name.trim() === 'יום') ?? defs.find((d) => !endsNextDay(d)) ?? defs[0]

export const newId = () => crypto.randomUUID()

const normalize = (name: string) => name.trim().toLocaleLowerCase()

// "כללי" was a certification every worker held (2026-11-08). The user removed it (2026-11-11): a place
// that asks for no certification is "ללא", and anyone fills it. Files saved before may still hold its id:
// it is dropped on read from the certifications list, from every worker and from every place.
export const GENERAL_CERT_ID = 'general'
const notGeneral = (id: string) => id !== GENERAL_CERT_ID
const withoutKey = <V,>(o: Record<string, V>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key))

/** The certifications list without the old "כללי". Same array when it was not there. */
export const withoutGeneralCert = (certs: Certification[]): Certification[] =>
  certs.some((c) => c.id === GENERAL_CERT_ID) ? certs.filter((c) => notGeneral(c.id)) : certs

// A worker's star rating in a certification: 1-5, or 0 = not rated yet (a new worker's certifications,
// until the manager rates them). Absent = the full 5: certifications held before ratings existed.
export const MAX_STARS = 5
export const certStars = (w: Pick<Worker, 'certRatings'>, certId: string) => {
  const n = w.certRatings?.[certId]
  return typeof n === 'number' && n >= 0 && n <= MAX_STARS ? Math.round(n) : MAX_STARS
}
/** Text for a place that asks for no certification: anyone can fill it. */
export const anyWorkerText = () => tx('ללא')

export const MAX_STAFF = 20

/**
 * A job's staffing, ready to show or edit: at least one person, a certification that no longer
 * exists dropped, and what older files held for roles left out.
 */
export function staffingFor(staffing: StaffSlot[] | undefined, certificationIds: string[]): StaffSlot[] {
  const slots: StaffSlot[] = staffing?.length ? staffing : [{}]
  return slots.map((s) => {
    const certs = slotCerts(s).filter((id) => certificationIds.includes(id))
    return { ...(certs.length ? { certificationIds: certs } : {}), ...(s.kindId ? { kindId: s.kindId } : {}) }
  })
}

/** The certifications the person in a place must all hold; older files kept one in `certificationId`. */
export const slotCerts = (slot: StaffSlot): string[] =>
  (slot.certificationIds ?? (slot.certificationId ? [slot.certificationId] : [])).filter(notGeneral)

/** "טיפוס + רתך" for one place; "ללא" when it asks for no certification. */
export function placeText(slot: StaffSlot, certs: { id: string; name: string }[]): string {
  const names = slotCerts(slot).flatMap((id) => certs.find((c) => c.id === id)?.name ?? [])
  return names.length ? names.join(' + ') : anyWorkerText()
}

/** "2 אנשים: טיפוס, ללא" for a job card. */
export function staffingText(slots: StaffSlot[], certs: { id: string; name: string }[]): string {
  const names = slots.map((s) => placeText(s, certs))
  return `${countText(slots.length, tx('אדם אחד'), tx('אנשים'))}: ${names.join(', ')}`
}

/** Grows or shrinks to `n` people; new people need no certification. */
export function resizeStaffing(slots: StaffSlot[], n: number): StaffSlot[] {
  const size = Math.min(MAX_STAFF, Math.max(1, Math.round(n) || 1))
  return size <= slots.length ? slots.slice(0, size) : [...slots, ...Array.from({ length: size - slots.length }, () => ({}))]
}

/** Returns an error message for a name, or null when it is valid. `selfId` is skipped when editing. */
export function nameError(name: string, existing: { id: string; name: string }[], selfId?: string): string | null {
  if (!name.trim()) return tx('צריך למלא שם')
  if (existing.some((e) => e.id !== selfId && normalize(e.name) === normalize(name))) return tx('השם הזה כבר קיים')
  return null
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function shiftError(shift: Omit<ShiftDefinition, 'id'>, existing: ShiftDefinition[], selfId?: string): string | null {
  const n = nameError(shift.name, existing, selfId)
  if (n) return n
  if (!TIME.test(shift.startTime) || !TIME.test(shift.endTime)) return tx('צריך שעת התחלה ושעת סיום')
  if (!Number.isInteger(shift.requiredHeadcount) || (shift.requiredHeadcount ?? 0) < 1) return tx('צריך לפחות אדם אחד בעבודה')
  return null
}

/** The explicit flag wins; older files without it: an end not after the start means the next day. */
export const endsNextDay = (s: Pick<ShiftDefinition, 'startTime' | 'endTime' | 'endsNextDay'>) => s.endsNextDay ?? s.endTime <= s.startTime

/** Upsert by id, keeping list order. */
export function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]
}

/** How many workers and shift types point at a certification. */
export function tagUsage(id: string, workers: Worker[], shifts: ShiftDefinition[]) {
  return {
    workers: workers.filter((w) => w.certificationIds.includes(id)).length,
    shifts: shifts.filter((s) => s.requiredCertificationIds.includes(id)).length,
  }
}

/** Every reference to a deleted certification, removed. Lists that did not change are returned as the same array. */
export function removeTagReferences(id: string, workers: Worker[], shifts: ShiftDefinition[]) {
  const usage = tagUsage(id, workers, shifts)
  return {
    workers: usage.workers
      ? workers.map((w) => {
          if (!w.certificationIds.includes(id)) return w
          const { [id]: _, ...ratings } = w.certRatings ?? {}
          const { [id]: _until, ...expiry } = w.certExpiry ?? {}
          return {
            ...w,
            certificationIds: w.certificationIds.filter((x) => x !== id),
            ...(w.certRatings ? { certRatings: ratings } : {}),
            ...(w.certExpiry ? { certExpiry: expiry } : {}),
          }
        })
      : workers,
    shifts: usage.shifts ? shifts.map((s) => ({ ...s, requiredCertificationIds: s.requiredCertificationIds.filter((x) => x !== id) })) : shifts,
  }
}

/** Names for display, in list order, ignoring ids that no longer exist. */
export function tagNames(ids: string[], tags: { id: string; name: string }[]): string[] {
  return tags.filter((t) => ids.includes(t.id)).map((t) => t.name)
}

export const fullName = (w: Pick<Worker, 'firstName' | 'lastName'>) => `${w.firstName} ${w.lastName}`.trim()

/** Workers holding every selected certification. Nothing selected = everyone. */
export function filterWorkers(workers: Worker[], certificationIds: string[]): Worker[] {
  return workers.filter((w) => certificationIds.every((id) => w.certificationIds.includes(id)))
}

/** Fills fields missing from older files (v0.2 workers had a single `name` and no certifications). */
/** An inactive worker is hidden from the list and never offered for a shift. */
export const isActive = (w: Pick<Worker, 'status'>) => w.status !== 'inactive'

export function normalizeWorker(raw: Partial<Worker> & { name?: string; phone?: string; roleIds?: unknown }): Worker {
  // `roleIds`: roles were removed (2026-11-08); a worker saved before keeps only their certifications.
  const { name, phone, roleIds: _roles, ...w } = raw
  const [first = '', ...rest] = (name ?? '').trim().split(/\s+/)
  return {
    ...w,
    id: w.id ?? newId(),
    firstName: w.firstName ?? first,
    lastName: w.lastName ?? rest.join(' '),
    mobilePhone: w.mobilePhone ?? phone,
    // The old "כללי" is gone (2026-11-11).
    certificationIds: (w.certificationIds ?? []).filter(notGeneral),
    ...(w.certRatings && GENERAL_CERT_ID in w.certRatings ? { certRatings: withoutKey(w.certRatings, GENERAL_CERT_ID) } : {}),
    ...(w.certExpiry && GENERAL_CERT_ID in w.certExpiry ? { certExpiry: withoutKey(w.certExpiry, GENERAL_CERT_ID) } : {}),
    constraints: (w.constraints ?? []).map(normalizeConstraint),
    status: w.status ?? 'active',
  }
}

export function normalizeShift(raw: Omit<ShiftDefinition, 'requiredCertificationIds'> & Partial<ShiftDefinition> & { requiredRoleIds?: unknown }): ShiftDefinition {
  const { requiredRoleIds: _roles, ...def } = raw
  return {
    ...def,
    endsNextDay: def.thenJob || endsNextDay(def),
    requiredCertificationIds: (raw.requiredCertificationIds ?? []).filter(notGeneral),
  }
}

/** Hebrew count: 1 gets its own word ("עובד אחד"), the rest "<n> <plural>". */
export const countText = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`)

// Dial link for the phone's own dialer. Keeps digits and a leading +; null when nothing dialable is left.
/** An Israeli mobile number: 05X and 7 more digits, or the same as +972 5X. Spaces, dashes and brackets are ignored. */
export function isIsraeliMobile(phone: string | undefined): boolean {
  const compact = (phone ?? '').replace(/[\s\-()]/g, '')
  return /^(?:05\d|\+9725\d|9725\d)\d{7}$/.test(compact)
}

export function telHref(phone: string | undefined): string | null {
  const trimmed = phone?.trim() ?? ''
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  return `tel:${trimmed.startsWith('+') ? '+' : ''}${digits}`
}
