import { tx } from '../../i18n'
import { Field, inputClass } from '../../components/Sheet'
import { useDriveList } from '../../lib/data/useDriveList'
import { pickVehicle, vehicleLabel, vehicleOptionText, vehiclePickList } from '../../lib/vehicles'

// The job's vehicle: one list of the vehicles in "רכבים", each shown as plate · model · make, sorted by
// model and then by make (the owner's request, 2026-11-15; it replaced the separate "דגם רכב" and
// "רישוי" fields). Not required.

type Pick = { vehicleId?: string; vehicleModel?: string }

const MODEL_ONLY = 'model-only'

export function VehiclePick({ value, onChange }: { value: Pick; onChange: (next: Pick) => void }) {
  const vehicles = useDriveList('vehicles')
  if (vehicles.query.isPending) return null
  if (!vehicles.items.length && !value.vehicleId && !value.vehicleModel)
    return <p className="text-xs text-slate-400">{tx('רכב לעבודה: עוד אין רכבים. מוסיפים אותם בלשונית "רכבים".')}</p>
  const list = vehiclePickList(vehicles.items)
  const gone = value.vehicleId && !vehicles.items.some((v) => v.id === value.vehicleId)
  // An older job may hold a model with no plate: it stays picked until the manager picks a vehicle.
  const modelOnly = !value.vehicleId && value.vehicleModel
  const current = value.vehicleId ?? (modelOnly ? MODEL_ONLY : '')

  return (
    <Field label={tx('רכב')}>
      <select
        value={current}
        onChange={(e) => {
          const id = e.target.value
          if (id === MODEL_ONLY) return
          onChange(id ? pickVehicle(id, vehicles.items) : { vehicleId: undefined, vehicleModel: undefined })
        }}
        className={inputClass}
      >
        <option value="">{tx('בלי')}</option>
        {gone && <option value={value.vehicleId}>{vehicleLabel(undefined)}</option>}
        {modelOnly && <option value={MODEL_ONLY}>{tx('{v}, בלי רישוי', { v: value.vehicleModel })}</option>}
        {list.map((v) => (
          <option key={v.id} value={v.id}>
            {vehicleOptionText(v)}
          </option>
        ))}
      </select>
    </Field>
  )
}
