import { describe, expect, it } from 'vitest'
import { cleanVehicle, jobVehicleText, pickModel, pickVehicle, STARTER_VEHICLE_FIELDS, vehicleError, vehicleModels, vehiclesOfModel, withFixedFields } from './vehicles'
import type { Vehicle } from '../types/models'

const v = (id: string, plate: string, model = ''): Vehicle => ({ id, values: { plate, ...(model ? { model } : {}) } })
const fleet = [v('1', '12-345-67', 'הילוקס'), v('2', '22-222-22', 'אקטרוס'), v('3', '33-333-33', 'הילוקס')]

describe('vehicles', () => {
  it('starts with 10 fields, and plate and model are always first', () => {
    expect(STARTER_VEHICLE_FIELDS).toHaveLength(10)
    expect(withFixedFields([{ id: 'km', name: 'ק"מ' }]).map((f) => f.id)).toEqual(['plate', 'model', 'km'])
    expect(withFixedFields([{ id: 'model', name: 'דגם' }, { id: 'plate', name: 'רישוי' }, { id: 'type', name: 'סוג' }]).map((f) => f.name)).toEqual(['רישוי', 'דגם', 'סוג'])
  })

  it('needs a plate, and the same plate twice is refused whatever the dashes', () => {
    expect(vehicleError(v('9', ' '), fleet)).toBe('צריך למלא מספר רישוי')
    expect(vehicleError(v('9', '1234567'), fleet)).toBe('רכב עם מספר הרישוי הזה כבר קיים')
    expect(vehicleError(v('1', '12-345-67'), fleet)).toBeNull()
    expect(cleanVehicle({ id: 'x', values: { plate: ' 1 ', km: '  ' } }).values).toEqual({ plate: '1' })
  })

  it('a model narrows the plates, a plate brings its model', () => {
    expect(vehicleModels(fleet)).toEqual(['אקטרוס', 'הילוקס'])
    expect(vehiclesOfModel(fleet, 'הילוקס').map((x) => x.id)).toEqual(['1', '3'])
    expect(pickVehicle('2', fleet)).toEqual({ vehicleId: '2', vehicleModel: 'אקטרוס' })
    expect(pickModel({ vehicleId: '2' }, 'הילוקס', fleet)).toEqual({ vehicleModel: 'הילוקס', vehicleId: undefined })
    expect(pickModel({ vehicleId: '1' }, 'הילוקס', fleet)).toEqual({ vehicleModel: 'הילוקס', vehicleId: '1' })
    expect(jobVehicleText({ vehicleId: '1' }, fleet)).toBe('12-345-67 · הילוקס')
    expect(jobVehicleText({ vehicleId: 'gone' }, fleet)).toBe('רכב שנמחק')
    expect(jobVehicleText({ vehicleModel: 'אקטרוס' }, fleet)).toBe('אקטרוס')
  })
})
