import { tx } from '../../i18n'
import { Field, inputClass } from '../../components/Sheet'
import { useDriveList } from '../../lib/data/useDriveList'
import { pickType, pickVehicle, plateOf, vehicleLabel, vehiclesOfType, vehicleTypes } from '../../lib/vehicles'

// "רישוי" and "סוג רכב" on a job (the user's request, 2026-11-13), both picked from the vehicles in
// "רכבים". Picking a type narrows the plates; picking a plate sets its type.

type Pick = { vehicleId?: string; vehicleType?: string }

export function VehiclePick({ value, onChange }: { value: Pick; onChange: (next: Pick) => void }) {
  const vehicles = useDriveList('vehicles')
  if (vehicles.query.isPending) return null
  if (!vehicles.items.length && !value.vehicleId && !value.vehicleType)
    return <p className="text-xs text-slate-400">{tx('רכב לעבודה: עוד אין רכבים. מוסיפים אותם בלשונית "רכבים".')}</p>
  const types = vehicleTypes(vehicles.items)
  if (value.vehicleType && !types.includes(value.vehicleType)) types.push(value.vehicleType)
  const plates = vehiclesOfType(vehicles.items, value.vehicleType)
  const gone = value.vehicleId && !vehicles.items.some((v) => v.id === value.vehicleId)

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={tx('סוג רכב')}>
        <select value={value.vehicleType ?? ''} onChange={(e) => onChange(pickType(value, e.target.value, vehicles.items))} className={inputClass}>
          <option value="">{tx('בלי')}</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tx('רישוי')}>
        <select value={value.vehicleId ?? ''} onChange={(e) => onChange(pickVehicle(e.target.value, vehicles.items, value.vehicleType))} className={inputClass}>
          <option value="">{tx('בלי')}</option>
          {gone && <option value={value.vehicleId}>{vehicleLabel(undefined)}</option>}
          {plates.map((v) => (
            <option key={v.id} value={v.id}>
              {plateOf(v)}
            </option>
          ))}
        </select>
      </Field>
    </div>
  )
}
