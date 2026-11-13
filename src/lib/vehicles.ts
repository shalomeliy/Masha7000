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
