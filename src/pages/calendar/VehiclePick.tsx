import { tx } from '../../i18n'
import { Field, inputClass } from '../../components/Sheet'
import { useDriveList } from '../../lib/data/useDriveList'
import { pickModel, pickVehicle, plateOf, vehicleLabel, vehiclesOfModel, vehicleModels } from '../../lib/vehicles'

// "רישוי" and "דגם רכב" on a job (the user's request, 2026-11-13), both picked from the vehicles in
// "רכבים". Picking a model narrows the plates; picking a plate sets its model.

type Pick = { vehicleId?: string; vehicleModel?: string }

export function VehiclePick({ value, onChange }: { value: Pick; onChange: (next: Pick) => void }) {
  const vehicles = useDriveList('vehicles')
  if (vehicles.query.isPending) return null
  if (!vehicles.items.length && !value.vehicleId && !value.vehicleModel)
    return <p className="text-xs text-slate-400">{tx('רכב לעבודה: עוד אין רכבים. מוסיפים אותם בלשונית "רכבים".')}</p>
  const models = vehicleModels(vehicles.items)
  if (value.vehicleModel && !models.includes(value.vehicleModel)) models.push(value.vehicleModel)
  const plates = vehiclesOfModel(vehicles.items, value.vehicleModel)
  const gone = value.vehicleId && !vehicles.items.some((v) => v.id === value.vehicleId)

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={tx('דגם רכב')}>
        <select value={value.vehicleModel ?? ''} onChange={(e) => onChange(pickModel(value, e.target.value, vehicles.items))} className={inputClass}>
          <option value="">{tx('בלי')}</option>
          {models.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tx('רישוי')}>
        <select value={value.vehicleId ?? ''} onChange={(e) => onChange(pickVehicle(e.target.value, vehicles.items, value.vehicleModel))} className={inputClass}>
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
