import { tx } from '../i18n'
import type { Vehicle, VehicleField } from '../types/models'

// "רכבים" (the user's request, 2026-11-13): the vehicles the jobs go out with. Each vehicle is a card of
// values; which values the card has is a list the manager edits in Settings. Two fields always exist,
// because a job picks its vehicle by them: the licence plate and the model (the user switched the job's
// field from type to model, 2026-11-13). Pure rules, no I/O.

export const PLATE = 'plate'
export const TYPE = 'type'
export const MODEL = 'model'

/** The card's fields when the manager has not changed the list yet. */
export const STARTER_VEHICLE_FIELDS: VehicleField[] = [
  { id: PLATE, name: tx('מספר רישוי') },
  { id: TYPE, name: tx('סוג רכב') },
  { id: 'make', name: tx('יצרן') },
  { id: 'model', name: tx('דגם') },
  { id: 'year', name: tx('שנת ייצור'), kind: 'number' },
  { id: 'color', name: tx('צבע') },
  { id: 'km', name: tx('ק"מ'), kind: 'number' },
  { id: 'testUntil', name: tx('תוקף טסט'), kind: 'date' },
  { id: 'insuranceUntil', name: tx('תוקף ביטוח'), kind: 'date' },
  { id: 'driver', name: tx('נהג קבוע') },
]

/** Fields that cannot be deleted: a job picks its vehicle by them. */
export const isFixedField = (id: string) => id === PLATE || id === MODEL

/** The list as read: the plate and model fields are always first, even if a file lost them. */
export function withFixedFields(list: VehicleField[]): VehicleField[] {
  const fixed = [PLATE, MODEL].map((id) => list.find((f) => f.id === id) ?? STARTER_VEHICLE_FIELDS.find((f) => f.id === id)!)
  return [...fixed, ...list.filter((f) => !isFixedField(f.id))]
}

export const plateOf = (v: Vehicle | undefined) => v?.values[PLATE]?.trim() ?? ''
export const typeOf = (v: Vehicle | undefined) => v?.values[TYPE]?.trim() ?? ''
export const modelOf = (v: Vehicle | undefined) => v?.values[MODEL]?.trim() ?? ''

/** Plates are compared by their digits and letters only: "12-345-67" is "1234567". */
const plateKey = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase()

/** Why the vehicle cannot be saved, or null. */
export function vehicleError(v: Vehicle, all: Vehicle[]): string | null {
  const plate = plateOf(v)
  if (!plate) return tx('צריך למלא מספר רישוי')
  if (all.some((x) => x.id !== v.id && plateKey(plateOf(x)) === plateKey(plate))) return tx('רכב עם מספר הרישוי הזה כבר קיים')
  return null
}

/** The vehicle with every value trimmed, and empty values left out. */
export function cleanVehicle(v: Vehicle): Vehicle {
  const values: Record<string, string> = {}
  for (const [k, x] of Object.entries(v.values)) if (x?.trim()) values[k] = x.trim()
  return { ...v, values }
}

/** "12-345-67 · הילוקס" */
export const vehicleLabel = (v: Vehicle | undefined) => (v ? [plateOf(v), modelOf(v)].filter(Boolean).join(' · ') : tx('רכב שנמחק'))

/** Every vehicle model in use, A to Z. */
export function vehicleModels(vehicles: Vehicle[]): string[] {
  return [...new Set(vehicles.map(modelOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'))
}

/** Vehicles of `model` (all when empty), by plate. */
export function vehiclesOfModel(vehicles: Vehicle[], model: string | undefined): Vehicle[] {
  return vehicles.filter((v) => !model || modelOf(v) === model).sort((a, b) => plateOf(a).localeCompare(plateOf(b), 'he'))
}

type JobVehicle = { vehicleId?: string; vehicleModel?: string }

/** A job's vehicle after the manager picks a model: a vehicle of another model is let go. */
export function pickModel(job: { vehicleId?: string }, model: string, vehicles: Vehicle[]): JobVehicle {
  const v = vehicles.find((x) => x.id === job.vehicleId)
  return { vehicleModel: model || undefined, vehicleId: v && model && modelOf(v) !== model ? undefined : job.vehicleId }
}

/** A job's vehicle after the manager picks one: its model comes with it. */
export function pickVehicle(id: string, vehicles: Vehicle[], currentModel?: string): JobVehicle {
  const v = vehicles.find((x) => x.id === id)
  return { vehicleId: v ? id : undefined, vehicleModel: v ? modelOf(v) || currentModel : currentModel }
}

/** The job's vehicle line for a card: "רכב: 12-345-67 · הילוקס", or the model alone. */
export function jobVehicleText(job: JobVehicle, vehicles: Vehicle[]): string {
  if (job.vehicleId) return vehicleLabel(vehicles.find((v) => v.id === job.vehicleId))
  return job.vehicleModel ?? ''
}

// ---- Expiry of the card's dates (the user's request, 2026-11-14) ----
// Like a worker's certification (src/lib/certExpiry.ts): orange "!" when a date ends within 30 days,
// red when it already passed. The test and insurance dates are required, so a missing one is red too.

export const VEHICLE_WARN_DAYS = 30
export const TEST = 'testUntil'
export const INSURANCE = 'insuranceUntil'
const REQUIRED_DATES = [TEST, INSURANCE]

export type VehicleExpiry = { fieldId: string; name: string; state: 'soon' | 'expired' | 'missing'; date?: string }

const plusDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** The card's date fields that are missing, passed, or end within 30 days of `today`, in the card's order. */
export function vehicleExpiries(v: Vehicle, fields: VehicleField[], today: string): VehicleExpiry[] {
  const soon = plusDays(today, VEHICLE_WARN_DAYS)
  return fields.flatMap((f): VehicleExpiry[] => {
    if (f.kind !== 'date') return []
    const date = v.values[f.id]?.trim()
    if (!date) return REQUIRED_DATES.includes(f.id) ? [{ fieldId: f.id, name: f.name, state: 'missing' }] : []
    if (date < today) return [{ fieldId: f.id, name: f.name, state: 'expired', date }]
    return date <= soon ? [{ fieldId: f.id, name: f.name, state: 'soon', date }] : []
  })
}

/** The worst of the vehicle's expiries: red beats orange; null when all is fine. */
export function worstExpiry(list: VehicleExpiry[]): 'red' | 'orange' | null {
  if (list.some((e) => e.state !== 'soon')) return 'red'
  return list.length ? 'orange' : null
}

// ---- The regular driver ("נהג קבוע") is one of the workers, kept by id ----

export const DRIVER = 'driver'

/** What a card value reads as: the driver's full name for a worker id, else the value as typed. */
export function shownValue(v: Vehicle, fieldId: string, workers: { id: string; firstName: string; lastName: string }[]): string {
  const raw = v.values[fieldId] ?? ''
  if (fieldId !== DRIVER) return raw
  const w = workers.find((x) => x.id === raw)
  return w ? `${w.firstName} ${w.lastName}`.trim() : raw
}

// ---- Example vehicles, added once by the owner from the רכבים tab (the user's request, 2026-11-14) ----

export const SAMPLE_PREFIX = 'sample-'
export const SAMPLE_COUNT = 14
export const hasSamples = (vehicles: Vehicle[]) => vehicles.some((v) => v.id.startsWith(SAMPLE_PREFIX))

// The owner's own list (2026-11-14): type, make, model, color.
const SAMPLE_CARS: [type: string, make: string, model: string, color: string][] = [
  ['טנדר', 'Ford', 'F-350 Super Duty', 'לבן'],
  ['טנדר', 'Ram', '3500 / 5500', 'אפור'],
  ['טנדר', 'Chevrolet', 'Silverado 2500HD / 3500HD', 'לבן'],
  ['טנדר', 'Isuzu', 'D-Max 4X4', 'כסוף'],
  ['טנדר', 'Ford', 'F-150', 'שחור'],
  ['רכב שטח', 'AM General', 'HMMWV', 'ירוק זית'],
  ['מסחרי', 'Fiat', 'Doblo', 'לבן'],
  ['מסחרי', 'Opel', 'Combo', 'לבן'],
  ['מסחרי', 'Peugeot', 'Rifter / Partner', 'אפור'],
  ['מסחרי', 'Renault', 'Kangoo', 'לבן'],
  ['מסחרי', 'Volkswagen', 'Caddy', 'כסוף'],
  ['מסחרי', 'Dacia', 'Dokker', 'לבן'],
  ['מסחרי', 'Nissan', 'NV200', 'לבן'],
  ['מסחרי', 'Ford', 'Tourneo / Transit Connect', 'כחול'],
]

// Days from today to [test, insurance]; null = not filled in. A mix the warnings can be seen on.
const SAMPLE_DATES: [number | null, number | null][] = [
  [null, 182], // no test date
  [-12, 160], // test expired
  [-40, -3], // both expired
  [190, 9], // insurance ends in 9 days
  [210, 25], // insurance ends in 25 days
  [14, 20], // both end soon
  [175, 185],
  [183, 179],
  [195, 188],
  [180, 200],
  [null, 15], // no test, insurance ends soon
  [186, 192],
  [-5, 178], // test expired
  [178, 12], // insurance ends in 12 days
]

/** A random Israeli plate: "12-345-67" (7 digits) or the newer "123-45-678" (8 digits). */
export function randomPlate(rand: () => number = Math.random): string {
  const d = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('')
  return rand() < 0.5 ? `${d(2)}-${d(3)}-${d(2)}` : `${d(3)}-${d(2)}-${d(3)}`
}

/**
 * The example vehicles (fourteen) with dates around `today`, plates not already taken, and a regular driver from
 * `workerIds` for most of them (none when there are no workers).
 */
export function sampleVehicles(today: string, existing: Vehicle[], workerIds: string[], rand: () => number = Math.random): Vehicle[] {
  const taken = new Set(existing.map((v) => plateKey(plateOf(v))))
  const drivers = [...workerIds].sort(() => rand() - 0.5)
  return SAMPLE_CARS.map(([type, make, model, color], i) => {
    let plate = randomPlate(rand)
    while (taken.has(plateKey(plate))) plate = randomPlate(rand)
    taken.add(plateKey(plate))
    const [test, insurance] = SAMPLE_DATES[i]
    const year = 2015 + Math.floor(rand() * 10)
    const values: Record<string, string> = {
      [PLATE]: plate,
      [TYPE]: type,
      make,
      [MODEL]: model,
      year: String(year),
      color,
      km: String((2026 - year) * 15_000 + Math.floor(rand() * 20_000)),
    }
    if (test !== null) values[TEST] = plusDays(today, test)
    if (insurance !== null) values[INSURANCE] = plusDays(today, insurance)
    if (i % 4 !== 3 && drivers.length) values[DRIVER] = drivers[i % drivers.length]
    return { id: `${SAMPLE_PREFIX}${i + 1}-${Math.floor(rand() * 1e9).toString(36)}`, values }
  })
}
