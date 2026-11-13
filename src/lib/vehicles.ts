import { tx } from '../i18n'
import type { Vehicle, VehicleField } from '../types/models'

// "רכבים" (the user's request, 2026-11-13): the vehicles the jobs go out with. Each vehicle is a card of
// values; which values the card has is a list the manager edits in Settings. Two fields always exist,
// because a job picks its vehicle by them: the licence plate and the vehicle type. Pure rules, no I/O.

export const PLATE = 'plate'
export const TYPE = 'type'

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
export const isFixedField = (id: string) => id === PLATE || id === TYPE

/** The list as read: the plate and type fields are always first, even if a file lost them. */
export function withFixedFields(list: VehicleField[]): VehicleField[] {
  const fixed = [PLATE, TYPE].map((id) => list.find((f) => f.id === id) ?? STARTER_VEHICLE_FIELDS.find((f) => f.id === id)!)
  return [...fixed, ...list.filter((f) => !isFixedField(f.id))]
}

export const plateOf = (v: Vehicle | undefined) => v?.values[PLATE]?.trim() ?? ''
export const typeOf = (v: Vehicle | undefined) => v?.values[TYPE]?.trim() ?? ''

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

/** "12-345-67 · טנדר" */
export const vehicleLabel = (v: Vehicle | undefined) => (v ? [plateOf(v), typeOf(v)].filter(Boolean).join(' · ') : tx('רכב שנמחק'))

/** Every vehicle type in use, A to Z. */
export function vehicleTypes(vehicles: Vehicle[]): string[] {
  return [...new Set(vehicles.map(typeOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'))
}

/** Vehicles of `type` (all when empty), by plate. */
export function vehiclesOfType(vehicles: Vehicle[], type: string | undefined): Vehicle[] {
  return vehicles.filter((v) => !type || typeOf(v) === type).sort((a, b) => plateOf(a).localeCompare(plateOf(b), 'he'))
}

/** A job's vehicle after the manager picks a type: a vehicle of another type is let go. */
export function pickType(job: { vehicleId?: string }, type: string, vehicles: Vehicle[]): { vehicleId?: string; vehicleType?: string } {
  const v = vehicles.find((x) => x.id === job.vehicleId)
  return { vehicleType: type || undefined, vehicleId: v && type && typeOf(v) !== type ? undefined : job.vehicleId }
}

/** A job's vehicle after the manager picks one: its type comes with it. */
export function pickVehicle(id: string, vehicles: Vehicle[], currentType?: string): { vehicleId?: string; vehicleType?: string } {
  const v = vehicles.find((x) => x.id === id)
  return { vehicleId: v ? id : undefined, vehicleType: v ? typeOf(v) || currentType : currentType }
}

/** The job's vehicle line for a card: "רכב: 12-345-67 · טנדר", or the type alone. */
export function jobVehicleText(job: { vehicleId?: string; vehicleType?: string }, vehicles: Vehicle[]): string {
  if (job.vehicleId) return vehicleLabel(vehicles.find((v) => v.id === job.vehicleId))
  return job.vehicleType ?? ''
}
