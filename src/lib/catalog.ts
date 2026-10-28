import type { Role, ShiftDefinition, StaffSlot, Worker } from '../types/models'

// Pure rules for the master lists (roles, certifications, workers, shift types). No I/O here.

export const STANDBY_HEADCOUNT = 3

export const STARTER_ROLES = ['טפסן', 'חשמלאי', 'טכנאי אנטנות', 'טכנאי מצלמות', 'כללי']

export const STARTER_CERTIFICATIONS = [
  'אנטנה עד גובה 20 מטר',
  'אנטנה בגובה 40 מטר',
  'אנטנה מעל 40 מטר',
  'חשמלאי מוסמך',
  'מהנדס חשמל',
]

// The user does not care about exact hours for now: a shift starts in the morning and ends at 16:00,
// either the same day or (a night job) the next day. Times are stored for the calendar later.
export const SHIFT_START = '07:00'
export const SHIFT_END = '16:00'

// The user's pattern: everyone works days; some also go out to a night job that ends the next afternoon.
export const STARTER_SHIFTS: Omit<ShiftDefinition, 'id'>[] = [
  { name: 'יום', startTime: SHIFT_START, endTime: SHIFT_END, requiredHeadcount: 1, requiredRoleIds: [], requiredCertificationIds: [] },
  {
    name: 'לילה',
    startTime: SHIFT_START,
    endTime: SHIFT_END,
    endsNextDay: true,
    requiredHeadcount: 1,
    requiredRoleIds: [],
    requiredCertificationIds: [],
  },
]

export const newId = () => crypto.randomUUID()

const normalize = (name: string) => name.trim().toLocaleLowerCase()

// "כללי" is the role every worker holds without marking it, and the default role a job asks for.
// It is found by name (older files may hold it under a random id), so it cannot be renamed or deleted.
export const GENERAL_ROLE_NAME = 'כללי'
export const GENERAL_ROLE_ID = 'general'

export const isGeneralRole = (r: Pick<Role, 'name'>) => normalize(r.name) === normalize(GENERAL_ROLE_NAME)

/** The roles list, with "כללי" first when the file does not hold it yet. Same array when nothing was added. */
export const withGeneralRole = (roles: Role[]): Role[] =>
  roles.some(isGeneralRole) ? roles : [{ id: GENERAL_ROLE_ID, name: GENERAL_ROLE_NAME }, ...roles]

export const generalRoleId = (roles: Role[]) => roles.find(isGeneralRole)?.id ?? GENERAL_ROLE_ID

/** Every worker holds the general role, marked or not. */
export const workerHasRole = (w: Pick<Worker, 'roleIds'>, roleId: string, generalId: string) => roleId === generalId || w.roleIds.includes(roleId)

export const MAX_STAFF = 20

/**
 * A job's staffing, ready to show or edit: at least one person; a role that no longer exists
 * falls back to "כללי", a certification that no longer exists is dropped.
 */
export function staffingFor(staffing: StaffSlot[] | undefined, roles: Role[], certificationIds: string[]): StaffSlot[] {
  const general = generalRoleId(roles)
  const slots = staffing?.length ? staffing : [{ roleId: general }]
  return slots.map((s) => ({
    roleId: roles.some((r) => r.id === s.roleId) ? s.roleId : general,
    certificationId: s.certificationId && certificationIds.includes(s.certificationId) ? s.certificationId : undefined,
  }))
}

/** "2 אנשים: טפסן (חשמלאי מוסמך), כללי" for a job card. */
export function staffingText(slots: StaffSlot[], roles: Role[], certs: { id: string; name: string }[]): string {
  const names = slots.map((s) => {
    const role = roles.find((r) => r.id === s.roleId)?.name ?? GENERAL_ROLE_NAME
    const cert = certs.find((c) => c.id === s.certificationId)?.name
    return cert ? `${role} (${cert})` : role
  })
  return `${countText(slots.length, 'אדם אחד', 'אנשים')}: ${names.join(', ')}`
}

/** Grows or shrinks to `n` people; new people need "כללי" and no certification. */
export function resizeStaffing(slots: StaffSlot[], n: number, generalId: string): StaffSlot[] {
  const size = Math.min(MAX_STAFF, Math.max(1, Math.round(n) || 1))
  return size <= slots.length ? slots.slice(0, size) : [...slots, ...Array.from({ length: size - slots.length }, () => ({ roleId: generalId }))]
}

/** Returns an error message for a name, or null when it is valid. `selfId` is skipped when editing. */
export function nameError(name: string, existing: { id: string; name: string }[], selfId?: string): string | null {
  if (!name.trim()) return 'צריך למלא שם'
  if (existing.some((e) => e.id !== selfId && normalize(e.name) === normalize(name))) return 'השם הזה כבר קיים'
  return null
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export function shiftError(shift: Omit<ShiftDefinition, 'id'>, existing: ShiftDefinition[], selfId?: string): string | null {
  const n = nameError(shift.name, existing, selfId)
  if (n) return n
  if (!TIME.test(shift.startTime) || !TIME.test(shift.endTime)) return 'צריך שעת התחלה ושעת סיום'
  if (!Number.isInteger(shift.requiredHeadcount) || (shift.requiredHeadcount ?? 0) < 1) return 'צריך לפחות אדם אחד במשמרת'
  return null
}

/** The explicit flag wins; older files without it: an end not after the start means the next day. */
export const endsNextDay = (s: Pick<ShiftDefinition, 'startTime' | 'endTime' | 'endsNextDay'>) => s.endsNextDay ?? s.endTime <= s.startTime

/** Upsert by id, keeping list order. */
export function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]
}

// Roles and certifications are both "tags": a named list referenced by workers and shift types.
export type TagKind = 'roles' | 'certifications'

const workerField = { roles: 'roleIds', certifications: 'certificationIds' } as const
const shiftField = { roles: 'requiredRoleIds', certifications: 'requiredCertificationIds' } as const

export function tagUsage(kind: TagKind, id: string, workers: Worker[], shifts: ShiftDefinition[]) {
  return {
    workers: workers.filter((w) => w[workerField[kind]].includes(id)).length,
    shifts: shifts.filter((s) => s[shiftField[kind]].includes(id)).length,
  }
}

/** Every reference to a deleted tag, removed. Lists that did not change are returned as the same array. */
export function removeTagReferences(kind: TagKind, id: string, workers: Worker[], shifts: ShiftDefinition[]) {
  const usage = tagUsage(kind, id, workers, shifts)
  const wf = workerField[kind]
  const sf = shiftField[kind]
  return {
    workers: usage.workers ? workers.map((w) => ({ ...w, [wf]: w[wf].filter((x) => x !== id) })) : workers,
    shifts: usage.shifts ? shifts.map((s) => ({ ...s, [sf]: s[sf].filter((x) => x !== id) })) : shifts,
  }
}

/** Names for display, in list order, ignoring ids that no longer exist. */
export function tagNames(ids: string[], tags: { id: string; name: string }[]): string[] {
  return tags.filter((t) => ids.includes(t.id)).map((t) => t.name)
}

export const fullName = (w: Pick<Worker, 'firstName' | 'lastName'>) => `${w.firstName} ${w.lastName}`.trim()

/** Workers holding every selected role and every selected certification. Nothing selected = everyone. */
export function filterWorkers(workers: Worker[], roleIds: string[], certificationIds: string[], generalId = GENERAL_ROLE_ID): Worker[] {
  return workers.filter(
    (w) => roleIds.every((id) => workerHasRole(w, id, generalId)) && certificationIds.every((id) => w.certificationIds.includes(id)),
  )
}

/** Fills fields missing from older files (v0.2 workers had a single `name` and no certifications). */
export function normalizeWorker(raw: Partial<Worker> & { name?: string; phone?: string }): Worker {
  const { name, phone, ...w } = raw
  const [first = '', ...rest] = (name ?? '').trim().split(/\s+/)
  return {
    ...w,
    id: w.id ?? newId(),
    firstName: w.firstName ?? first,
    lastName: w.lastName ?? rest.join(' '),
    mobilePhone: w.mobilePhone ?? phone,
    roleIds: w.roleIds ?? [],
    certificationIds: w.certificationIds ?? [],
    constraints: w.constraints ?? [],
  }
}

export function normalizeShift(raw: Omit<ShiftDefinition, 'requiredCertificationIds'> & Partial<ShiftDefinition>): ShiftDefinition {
  return {
    ...raw,
    endsNextDay: endsNextDay(raw),
    requiredRoleIds: raw.requiredRoleIds ?? [],
    requiredCertificationIds: raw.requiredCertificationIds ?? [],
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
