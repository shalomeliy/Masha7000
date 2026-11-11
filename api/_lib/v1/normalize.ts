// Copies of the app's read-time upgrades (src/lib/catalog.ts normalizeWorker and certStars,
// src/lib/constraints.ts normalizeConstraint, src/lib/shifts.ts normalizeShiftRecord /
// normalizePendingJob, slotCerts), for the server: api/ cannot import src/. The test
// src/lib/apiNormalize.test.ts runs both on the same files, so the copies cannot drift.
// Only what the outside API shows is copied; nothing here writes back.

// The old certification "כללי" (removed 2026-11-11): files saved before may still hold its id; dropped on read.
export const GENERAL_CERT_ID = 'general'
const notGeneral = (id: string) => id !== GENERAL_CERT_ID
const withoutKey = <V>(o: Record<string, V>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key))
export const MAX_STARS = 5

type Raw = Record<string, unknown>

export interface StoredConstraint {
  id: string
  kind?: string
  when: 'dates' | 'weekdays' | 'always'
  from?: string
  to?: string
  weekdays?: number[]
  nightsOnly?: boolean
  part?: string
  note?: string
}

export interface StoredWorker {
  id: string
  firstName: string
  lastName: string
  certificationIds: string[]
  certRatings?: Record<string, number>
  certExpiry?: Record<string, string>
  constraints: StoredConstraint[]
  status: string
  sickUntil?: string
  departmentId?: string
  birthDate?: string
  address?: string
  mobilePhone?: string
  homePhone?: string
  emergencyPhone1?: string
  emergencyPhone2?: string
  idNumber?: string
  personalNumber?: string
  notes?: string
}

export interface StoredSlot {
  certificationId?: string
  certificationIds?: string[]
  kindId?: string
}

export interface StoredShift {
  id: string
  date: string
  shiftDefinitionId?: string
  location: string
  jobDescription: string
  crew: { workerId: string }[]
  staffing: StoredSlot[]
  workKindIds?: string[]
  urgent?: boolean
  startTime?: string
  endDate?: string
  endTime?: string
  fromJobId?: string
  closure?: { outcome: string; note?: string; reasonIds: string[]; closedAt: string; followUp?: { location: string; jobDescription: string } }
  nextJob?: { location: string; jobDescription: string }
  pinnedIds?: string[]
}

export interface StoredPendingJob {
  id: string
  location: string
  jobDescription: string
  staffing: StoredSlot[]
  shiftDefinitionId?: string
  workKindIds?: string[]
  fromShiftId?: string
  outcome?: string
  note?: string
  reasonIds: string[]
  createdAt: string
  followUp?: true
  scheduledShiftId?: string
  pinnedIds?: string[]
}

export const slotCerts = (slot: StoredSlot): string[] =>
  (slot.certificationIds ?? (slot.certificationId ? [slot.certificationId] : [])).filter(notGeneral)

export const certStars = (w: Pick<StoredWorker, 'certRatings'>, certId: string) => {
  const n = w.certRatings?.[certId]
  return typeof n === 'number' && n >= 0 && n <= MAX_STARS ? Math.round(n) : MAX_STARS
}

export function normalizeConstraint(raw: Raw): StoredConstraint {
  const { date, reason, ...c } = raw as Partial<StoredConstraint> & { date?: string; reason?: string }
  const when = c.when ?? 'dates'
  const from = c.from ?? date
  return {
    ...c,
    id: c.id ?? crypto.randomUUID(),
    when,
    from: when === 'dates' ? from : when === 'weekdays' ? c.from || undefined : undefined,
    to: when === 'dates' ? (c.to ?? from) : when === 'weekdays' ? c.to || undefined : undefined,
    weekdays: when === 'weekdays' ? (c.weekdays ?? []) : undefined,
    nightsOnly: when === 'always' ? true : c.nightsOnly || undefined,
    note: c.note ?? (reason?.trim() || undefined),
    ...(!c.kind && when === 'dates' && c.note?.trim() === 'מחלה' ? { kind: 'sick' } : {}),
  }
}

export function normalizeWorker(raw: Raw): StoredWorker {
  const { name, phone, roleIds: _roles, ...w } = raw as Partial<StoredWorker> & { name?: string; phone?: string; roleIds?: unknown }
  const [first = '', ...rest] = (name ?? '').trim().split(/\s+/)
  return {
    ...w,
    id: w.id ?? crypto.randomUUID(),
    firstName: w.firstName ?? first,
    lastName: w.lastName ?? rest.join(' '),
    mobilePhone: w.mobilePhone ?? phone,
    certificationIds: (w.certificationIds ?? []).filter(notGeneral),
    ...(w.certRatings && GENERAL_CERT_ID in w.certRatings ? { certRatings: withoutKey(w.certRatings, GENERAL_CERT_ID) } : {}),
    ...(w.certExpiry && GENERAL_CERT_ID in w.certExpiry ? { certExpiry: withoutKey(w.certExpiry, GENERAL_CERT_ID) } : {}),
    constraints: ((w.constraints ?? []) as unknown as Raw[]).map(normalizeConstraint),
    status: w.status ?? 'active',
  }
}

export const normalizeShiftRecord = (raw: Raw): StoredShift =>
  ({ location: '', jobDescription: '', ...raw, crew: raw.crew ?? [], staffing: raw.staffing ?? [] }) as StoredShift

export const normalizePendingJob = (raw: Raw): StoredPendingJob =>
  ({ location: '', jobDescription: '', createdAt: '', ...raw, reasonIds: raw.reasonIds ?? [], staffing: raw.staffing ?? [] }) as StoredPendingJob

export const withoutGeneralCert = <T extends { id: string }>(certs: T[]): T[] =>
  certs.some((c) => c.id === GENERAL_CERT_ID) ? certs.filter((c) => notGeneral(c.id)) : certs
