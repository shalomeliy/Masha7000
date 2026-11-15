import { tx } from '../../i18n'
import { ChoiceList, type Choice } from '../../components/ChoiceList'
import { useDriveList } from '../../lib/data/useDriveList'
import { pickVehicle, vehicleLabel, vehicleOptionText, vehiclePickList } from '../../lib/vehicles'

// The job's vehicle: one list of the vehicles in "רכבים", each shown as make · model · plate, A to Z by
// make and then model (the owner's request, 2026-11-15; it replaced the separate "דגם רכב" and
// "רישוי" fields). Drawn by the app so the round mark sits on the right in Hebrew. Not required.

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

  const options: Choice[] = [
    { value: '', label: tx('בלי') },
    ...(gone ? [{ value: value.vehicleId!, label: vehicleLabel(undefined) }] : []),
    ...(modelOnly ? [{ value: MODEL_ONLY, label: tx('{v}, בלי רישוי', { v: value.vehicleModel }) }] : []),
    ...list.map((v) => ({ value: v.id, label: vehicleOptionText(v) })),
  ]

  return (
    <ChoiceList
      label={tx('רכב')}
      value={current}
      options={options}
      onChange={(id) => {
        if (id === MODEL_ONLY || id === value.vehicleId) return
        onChange(id ? pickVehicle(id, vehicles.items) : { vehicleId: undefined, vehicleModel: undefined })
      }}
    />
  )
}
