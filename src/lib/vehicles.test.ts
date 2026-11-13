import { describe, expect, it } from 'vitest'
import { cleanVehicle, jobVehicleText, pickType, pickVehicle, STARTER_VEHICLE_FIELDS, vehicleError, vehiclesOfType, vehicleTypes, withFixedFields } from './vehicles'
import type { Vehicle } from '../types/models'

const v = (id: string, plate: string, type = ''): Vehicle => ({ id, values: { plate, ...(type ? { type } : {}) } })
const fleet = [v('1', '12-345-67', 'טנדר'), v('2', '22-222-22', 'משאית'), v('3', '33-333-33', 'טנדר')]

describe('vehicles', () => {
  it('starts with 10 fields, and plate and type are always first', () => {
    expect(STARTER_VEHICLE_FIELDS).toHaveLength(10)
    expect(withFixedFields([{ id: 'km', name: 'ק"מ' }]).map((f) => f.id)).toEqual(['plate', 'type', 'km'])
    expect(withFixedFields([{ id: 'type', name: 'סוג' }, { id: 'plate', name: 'רישוי' }]).map((f) => f.name)).toEqual(['רישוי', 'סוג'])
  })

  it('needs a plate, and the same plate twice is refused whatever the dashes', () => {
    expect(vehicleError(v('9', ' '), fleet)).toBe('צריך למלא מספר רישוי')
    expect(vehicleError(v('9', '1234567'), fleet)).toBe('רכב עם מספר הרישוי הזה כבר קיים')
    expect(vehicleError(v('1', '12-345-67'), fleet)).toBeNull()
    expect(cleanVehicle({ id: 'x', values: { plate: ' 1 ', km: '  ' } }).values).toEqual({ plate: '1' })
  })

  it('a type narrows the plates, a plate brings its type', () => {
    expect(vehicleTypes(fleet)).toEqual(['טנדר', 'משאית'])
    expect(vehiclesOfType(fleet, 'טנדר').map((x) => x.id)).toEqual(['1', '3'])
    expect(pickVehicle('2', fleet)).toEqual({ vehicleId: '2', vehicleType: 'משאית' })
    expect(pickType({ vehicleId: '2' }, 'טנדר', fleet)).toEqual({ vehicleType: 'טנדר', vehicleId: undefined })
    expect(pickType({ vehicleId: '1' }, 'טנדר', fleet)).toEqual({ vehicleType: 'טנדר', vehicleId: '1' })
    expect(jobVehicleText({ vehicleId: '1' }, fleet)).toBe('12-345-67 · טנדר')
    expect(jobVehicleText({ vehicleId: 'gone' }, fleet)).toBe('רכב שנמחק')
    expect(jobVehicleText({ vehicleType: 'משאית' }, fleet)).toBe('משאית')
  })
})
