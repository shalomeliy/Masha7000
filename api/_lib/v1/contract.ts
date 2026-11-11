import { certStars, slotCerts, type StoredConstraint, type StoredPendingJob, type StoredShift, type StoredSlot, type StoredWorker } from './normalize.js'

// What the outside API shows: clean, stable shapes made from the stored files. Old fields
// (roles, a single certificationId) never leave. A worker's personal fields leave only in
// `personal`, and only for a key made "כולל פרטים אישיים". The JSON Schema below is the contract;
// a change that breaks it raises SCHEMA_VERSION. docs/api.md explains it in words.

export const SCHEMA_VERSION = 1

export interface ApiConstraint {
  id: string
  kind: string | null // vacation | study | reserve | course | sick, null = an ordinary constraint
  when: 'dates' | 'weekdays' | 'always'
  from: string | null
  to: string | null
  weekdays: number[] // 0 = Sunday
  nightsOnly: boolean
  part: string | null // morning | noon | evening, null = the whole day
  note?: string // personal keys only
}

export interface ApiWorker {
  id: string
  firstName: string
  lastName: string
  status: string // active | sick | inactive
  sickUntil: string | null
  departmentId: string | null
  certifications: { id: string; stars: number; validUntil: string | null }[]
  constraints: ApiConstraint[]
  personal?: {
    idNumber: string | null
    personalNumber: string | null
    birthDate: string | null
    address: string | null
    mobilePhone: string | null
    homePhone: string | null
    emergencyPhones: string[]
    notes: string | null
  }
}

export interface ApiSlot {
  certificationIds: string[] // empty = any worker
  workKindId: string | null
}

export interface ApiShift {
  id: string
  date: string
  shiftKindId: string | null
  location: string
  jobDescription: string
  crew: string[] // worker ids
  pinnedWorkerIds: string[]
  staffing: ApiSlot[]
  workKindIds: string[]
  urgent: boolean
  startTime: string | null
  endDate: string | null
  endTime: string | null
  fromPendingJobId: string | null
  nextJob: { location: string; jobDescription: string } | null
  closure: { outcome: string; note: string | null; reasonIds: string[]; closedAt: string } | null
}

export interface ApiPendingJob {
  id: string
  location: string
  jobDescription: string
  shiftKindId: string | null
  staffing: ApiSlot[]
  workKindIds: string[]
  pinnedWorkerIds: string[]
  createdAt: string
  fromShiftId: string | null
  scheduledShiftId: string | null
  outcome: string | null
  note: string | null
}

export interface ApiNamed {
  id: string
  name: string
}

const n = <T>(v: T | undefined | null): T | null => (v === undefined || v === '' ? null : v)
const slot = (s: StoredSlot): ApiSlot => ({ certificationIds: slotCerts(s), workKindId: n(s.kindId) })

export function toApiConstraint(c: StoredConstraint, personal: boolean): ApiConstraint {
  return {
    id: c.id,
    kind: n(c.kind),
    when: c.when,
    from: n(c.from),
    to: n(c.to),
    weekdays: c.weekdays ?? [],
    nightsOnly: c.nightsOnly === true,
    part: n(c.part),
    ...(personal && c.note ? { note: c.note } : {}),
  }
}

export function toApiWorker(w: StoredWorker, personal: boolean): ApiWorker {
  return {
    id: w.id,
    firstName: w.firstName,
    lastName: w.lastName,
    status: w.status,
    sickUntil: w.status === 'sick' ? n(w.sickUntil) : null,
    departmentId: n(w.departmentId),
    certifications: w.certificationIds.map((id) => ({ id, stars: certStars(w, id), validUntil: n(w.certExpiry?.[id]) })),
    constraints: w.constraints.map((c) => toApiConstraint(c, personal)),
    ...(personal
      ? {
          personal: {
            idNumber: n(w.idNumber),
            personalNumber: n(w.personalNumber),
            birthDate: n(w.birthDate),
            address: n(w.address),
            mobilePhone: n(w.mobilePhone),
            homePhone: n(w.homePhone),
            emergencyPhones: [w.emergencyPhone1, w.emergencyPhone2].filter((p): p is string => !!p),
            notes: n(w.notes),
          },
        }
      : {}),
  }
}

export function toApiShift(s: StoredShift): ApiShift {
  return {
    id: s.id,
    date: s.date,
    shiftKindId: n(s.shiftDefinitionId),
    location: s.location,
    jobDescription: s.jobDescription,
    crew: s.crew.map((c) => c.workerId),
    pinnedWorkerIds: s.pinnedIds ?? [],
    staffing: s.staffing.map(slot),
    workKindIds: s.workKindIds ?? [],
    urgent: s.urgent === true,
    startTime: n(s.startTime),
    endDate: n(s.endDate),
    endTime: n(s.endTime),
    fromPendingJobId: n(s.fromJobId),
    nextJob: s.nextJob ?? null,
    closure: s.closure ? { outcome: s.closure.outcome, note: n(s.closure.note), reasonIds: s.closure.reasonIds ?? [], closedAt: s.closure.closedAt } : null,
  }
}

export function toApiPendingJob(j: StoredPendingJob): ApiPendingJob {
  return {
    id: j.id,
    location: j.location,
    jobDescription: j.jobDescription,
    shiftKindId: n(j.shiftDefinitionId),
    staffing: j.staffing.map(slot),
    workKindIds: j.workKindIds ?? [],
    pinnedWorkerIds: j.pinnedIds ?? [],
    createdAt: j.createdAt,
    fromShiftId: n(j.fromShiftId),
    scheduledShiftId: n(j.scheduledShiftId),
    outcome: n(j.outcome),
    note: n(j.note),
  }
}

export const toApiNamed = (x: { id: string; name: string }): ApiNamed => ({ id: x.id, name: x.name })

// ---- JSON Schema (draft 2020-12) of every shape above ----

const str = { type: 'string' }
const strOrNull = { type: ['string', 'null'] }
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const dateOrNull = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const ids = { type: 'array', items: str }
const obj = (properties: Record<string, unknown>, optional: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((k) => !optional.includes(k)),
})
const slotSchema = obj({ certificationIds: ids, workKindId: strOrNull })

export const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Masha7000 API',
  version: SCHEMA_VERSION,
  $defs: {
    Constraint: obj(
      {
        id: str,
        kind: { type: ['string', 'null'], enum: ['vacation', 'study', 'reserve', 'course', 'sick', null] },
        when: { enum: ['dates', 'weekdays', 'always'] },
        from: dateOrNull,
        to: dateOrNull,
        weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 } },
        nightsOnly: { type: 'boolean' },
        part: { type: ['string', 'null'], enum: ['morning', 'noon', 'evening', null] },
        note: str,
      },
      ['note'],
    ),
    Worker: obj(
      {
        id: str,
        firstName: str,
        lastName: str,
        status: { enum: ['active', 'sick', 'inactive'] },
        sickUntil: dateOrNull,
        departmentId: strOrNull,
        certifications: { type: 'array', items: obj({ id: str, stars: { type: 'integer', minimum: 0, maximum: 5 }, validUntil: dateOrNull }) },
        constraints: { type: 'array', items: { $ref: '#/$defs/Constraint' } },
        personal: obj({
          idNumber: strOrNull,
          personalNumber: strOrNull,
          birthDate: dateOrNull,
          address: strOrNull,
          mobilePhone: strOrNull,
          homePhone: strOrNull,
          emergencyPhones: ids,
          notes: strOrNull,
        }),
      },
      ['personal'],
    ),
    Slot: slotSchema,
    Shift: obj({
      id: str,
      date,
      shiftKindId: strOrNull,
      location: str,
      jobDescription: str,
      crew: ids,
      pinnedWorkerIds: ids,
      staffing: { type: 'array', items: { $ref: '#/$defs/Slot' } },
      workKindIds: ids,
      urgent: { type: 'boolean' },
      startTime: strOrNull,
      endDate: dateOrNull,
      endTime: strOrNull,
      fromPendingJobId: strOrNull,
      nextJob: { type: ['object', 'null'], additionalProperties: false, properties: { location: str, jobDescription: str }, required: ['location', 'jobDescription'] },
      closure: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: { outcome: { enum: ['done', 'partial', 'postponed'] }, note: strOrNull, reasonIds: ids, closedAt: str },
        required: ['outcome', 'note', 'reasonIds', 'closedAt'],
      },
    }),
    PendingJob: obj({
      id: str,
      location: str,
      jobDescription: str,
      shiftKindId: strOrNull,
      staffing: { type: 'array', items: { $ref: '#/$defs/Slot' } },
      workKindIds: ids,
      pinnedWorkerIds: ids,
      createdAt: str,
      fromShiftId: strOrNull,
      scheduledShiftId: strOrNull,
      outcome: { type: ['string', 'null'], enum: ['partial', 'postponed', null] },
      note: strOrNull,
    }),
    Named: obj({ id: str, name: str }),
  },
} as const
