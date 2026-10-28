import type { ShiftDefinition, Worker } from '../types/models'

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
export function filterWorkers(workers: Worker[], roleIds: string[], certificationIds: string[]): Worker[] {
  return workers.filter(
    (w) => roleIds.every((id) => w.roleIds.includes(id)) && certificationIds.every((id) => w.certificationIds.includes(id)),
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
