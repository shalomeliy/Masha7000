import { tx } from '../i18n'
import type { Vehicle } from '../types/models'

// "רכבים" (the user's request, 2026-11-13): the vehicles the jobs go out with. On 2026-11-14 the owner
// cut the card to three fields: licence plate, model and make. A job picks its vehicle by plate and model.
// Pure rules, no I/O.

export const PLATE = 'plate'
export const MODEL = 'model'
export const MAKE = 'make'

/** The card's fields, in order. Older files may hold other values (type, test, insurance...): they are not shown and are dropped on the next save. */
export const VEHICLE_FIELDS: { id: string; name: string }[] = [
  { id: PLATE, name: tx('מספר רישוי') },
  { id: MODEL, name: tx('דגם') },
  { id: MAKE, name: tx('יצרן') },
]
const FIELD_IDS = VEHICLE_FIELDS.map((f) => f.id)

export const plateOf = (v: Vehicle | undefined) => v?.values[PLATE]?.trim() ?? ''
export const modelOf = (v: Vehicle | undefined) => v?.values[MODEL]?.trim() ?? ''
export const makeOf = (v: Vehicle | undefined) => v?.values[MAKE]?.trim() ?? ''

/** Plates are compared by their digits and letters only: "12-345-67" is "1234567". */
const plateKey = (s: string) => s.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase()

/** Why the vehicle cannot be saved, or null. */
export function vehicleError(v: Vehicle, all: Vehicle[]): string | null {
  const plate = plateOf(v)
  if (!plate) return tx('צריך למלא מספר רישוי')
  if (all.some((x) => x.id !== v.id && plateKey(plateOf(x)) === plateKey(plate))) return tx('רכב עם מספר הרישוי הזה כבר קיים')
  return null
}

/** The vehicle with its three values trimmed; empty values and values of removed fields left out. */
export function cleanVehicle(v: Vehicle): Vehicle {
  const values: Record<string, string> = {}
  for (const [k, x] of Object.entries(v.values)) if (FIELD_IDS.includes(k) && x?.trim()) values[k] = x.trim()
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

// ---- Example vehicles, added once by the owner from the רכבים tab (the user's request, 2026-11-14) ----

export const SAMPLE_PREFIX = 'sample-'
export const hasSamples = (vehicles: Vehicle[]) => vehicles.some((v) => v.id.startsWith(SAMPLE_PREFIX))

// The owner's own list (2026-11-14): make, model.
const SAMPLE_CARS: [make: string, model: string][] = [
  ['Ford', 'F-350 Super Duty'],
  ['Ram', '3500 / 5500'],
  ['Chevrolet', 'Silverado 2500HD / 3500HD'],
  ['Isuzu', 'D-Max 4X4'],
  ['Ford', 'F-150'],
  ['AM General', 'HMMWV'],
  ['Fiat', 'Doblo'],
  ['Opel', 'Combo'],
  ['Peugeot', 'Rifter / Partner'],
  ['Renault', 'Kangoo'],
  ['Volkswagen', 'Caddy'],
  ['Dacia', 'Dokker'],
  ['Nissan', 'NV200'],
  ['Ford', 'Tourneo / Transit Connect'],
]
export const SAMPLE_COUNT = SAMPLE_CARS.length

/** A random Israeli plate: "12-345-67" (7 digits) or the newer "123-45-678" (8 digits). */
export function randomPlate(rand: () => number = Math.random): string {
  const d = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 10)).join('')
  return rand() < 0.5 ? `${d(2)}-${d(3)}-${d(2)}` : `${d(3)}-${d(2)}-${d(3)}`
}

/** The example vehicles, with random plates not already taken. */
export function sampleVehicles(existing: Vehicle[], rand: () => number = Math.random): Vehicle[] {
  const taken = new Set(existing.map((v) => plateKey(plateOf(v))))
  return SAMPLE_CARS.map(([make, model], i) => {
    let plate = randomPlate(rand)
    while (taken.has(plateKey(plate))) plate = randomPlate(rand)
    taken.add(plateKey(plate))
    return { id: `${SAMPLE_PREFIX}${i + 1}-${Math.floor(rand() * 1e9).toString(36)}`, values: { [PLATE]: plate, [MODEL]: model, [MAKE]: make } }
  })
}
